/**
 * The single fetch transport for the Responses API. It owns HTTP, SSE
 * framing, timeout, cancellation, and transport-level errors only — no
 * provider semantics live here.
 *
 * - POSTs `{baseUrl}/responses` with a Bearer token.
 * - Parses SSE line-by-line: `data:` lines, blank-line event boundaries,
 *   half-lines stay buffered across chunks, and multiple `data:` lines of one
 *   event are joined with `\n` per the SSE spec. There is no `[DONE]`
 *   sentinel on any of the three providers; one is tolerated if seen.
 * - HTTP errors are read to completion and mapped to `ResponsesHttpError`
 *   with status / retry metadata. Network failures and clean EOF stay
 *   distinguishable (`ResponsesStreamInterruptedError` vs. the generator
 *   simply ending; the accumulator turns a terminal-less EOF into an
 *   interruption error).
 * - A 12s connect timeout guards the headers-arrival phase; failures before
 *   response headers (connect timeout, ECONNRESET/EOF/undici headers-timeout)
 *   get one retry with exponential backoff, because the request never reached
 *   the provider and cannot be double-billed. Once headers arrived, a stream
 *   interruption is never retried (the provider already processed = billed).
 */
import type {
  ResponsesRequestBody,
  ResponsesResponsePayload,
  ResponsesStreamEvent,
} from "./types";

const DEFAULT_TIMEOUT_MS = 300_000;
/** 响应头到达前的连接超时；只覆盖连接/首包阶段，不影响整体 300s 请求超时。 */
export const RESPONSES_CONNECT_TIMEOUT_MS = 12_000;
/** 响应头到达前的网络失败重试次数（一次重试）。 */
export const RESPONSES_NETWORK_RETRY_ATTEMPTS = 1;
/** 指数退避基数：第 N 次重试等待 BASE * 2^N ms（首次重试 400ms）。 */
export const RESPONSES_NETWORK_RETRY_BASE_DELAY_MS = 400;
const RESPONSES_PATH = "/responses";

export class ResponsesHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    public readonly retryable: boolean,
    public readonly retryAfterMs?: number
  ) {
    super(
      `Responses API HTTP ${status}${body ? `: ${body.slice(0, 500)}` : ""}`
    );
    this.name = "ResponsesHttpError";
  }
}

export class ResponsesTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`Responses API request timed out after ${timeoutMs}ms`);
    this.name = "ResponsesTimeoutError";
  }
}

export class ResponsesConnectTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(
      `Responses API connect timed out after ${timeoutMs}ms (response headers never arrived)`
    );
    this.name = "ResponsesConnectTimeoutError";
  }
}

export type ResponsesStreamInterruptReason = "network" | "eof_without_terminal";

export class ResponsesStreamInterruptedError extends Error {
  constructor(
    public readonly reason: ResponsesStreamInterruptReason,
    message?: string,
    options?: { cause?: unknown }
  ) {
    super(
      message ??
        (reason === "network"
          ? "Responses stream interrupted by a network error"
          : "Responses stream ended without a terminal event"),
      options
    );
    this.name = "ResponsesStreamInterruptedError";
  }
}

export interface ResponsesTransportRequest {
  /** Provider base URL; `/responses` is appended. */
  baseUrl: string;
  apiKey: string;
  body: ResponsesRequestBody;
  signal?: AbortSignal;
  /** Whole-request timeout, matching the legacy SDK client semantics. */
  timeoutMs?: number;
  /** 响应头到达前的连接超时（默认 12s）。 */
  connectTimeoutMs?: number;
  /** Extra headers (e.g. Qwen session-cache hints). */
  headers?: Record<string, string>;
  /** Test seam; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export async function streamResponses(
  request: ResponsesTransportRequest
): Promise<AsyncIterable<ResponsesStreamEvent>> {
  const { response, wired } = await sendRequest(
    { ...request, body: { ...request.body, stream: true } },
    "text/event-stream"
  );
  return iterateSseEvents(response, wired);
}

/** Non-streaming variant used by summary/title-style one-shot callers. */
export async function postResponses(
  request: ResponsesTransportRequest
): Promise<ResponsesResponsePayload> {
  const { response, wired } = await sendRequest(
    { ...request, body: { ...request.body, stream: false } },
    "application/json"
  );
  try {
    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new ResponsesStreamInterruptedError(
        "network",
        "Responses API returned invalid JSON",
        { cause: error }
      );
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ResponsesStreamInterruptedError(
        "network",
        "Responses API returned a non-object JSON payload"
      );
    }
    return parsed as ResponsesResponsePayload;
  } finally {
    wired.cleanup();
  }
}

interface WiredSignal {
  signal: AbortSignal;
  cleanup(): void;
  cancel(): void;
  /** 响应头已到达：清除连接超时计时器（此后进入已计费阶段，不再重试）。 */
  headersReceived(): void;
}

function wireSignal(
  external: AbortSignal | undefined,
  timeoutMs: number,
  connectTimeoutMs: number
): WiredSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new ResponsesTimeoutError(timeoutMs));
  }, timeoutMs);
  (timer as unknown as { unref?: () => void }).unref?.();
  // 连接超时只约束「响应头到达前」；fetch resolve（头到达）后由
  // headersReceived() 清除，避免误杀正常的长时间流式下载。
  const connectTimer = setTimeout(() => {
    controller.abort(new ResponsesConnectTimeoutError(connectTimeoutMs));
  }, connectTimeoutMs);
  (connectTimer as unknown as { unref?: () => void }).unref?.();
  const relay = () => controller.abort(external?.reason);
  if (external?.aborted) relay();
  external?.addEventListener("abort", relay, { once: true });
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
      clearTimeout(connectTimer);
      external?.removeEventListener("abort", relay);
    },
    cancel() {
      if (!controller.signal.aborted) {
        controller.abort(new DOMException("The operation was aborted", "AbortError"));
      }
    },
    headersReceived() {
      clearTimeout(connectTimer);
    },
  };
}

function responsesUrl(baseUrl: string) {
  return `${baseUrl.replace(/\/+$/, "")}${RESPONSES_PATH}`;
}

/**
 * 响应头到达前的失败是否可重试：该阶段请求未被供应商受理，重试无重复计费
 * 风险。整体超时（ResponsesTimeoutError）不重试——请求可能已被受理只是响应
 * 缓慢；HTTP 错误（ResponsesHttpError）由调用方按 status/retry 元数据决策。
 */
function isRetryablePreHeadersFailure(error: unknown): boolean {
  if (error instanceof ResponsesConnectTimeoutError) return true;
  return (
    error instanceof ResponsesStreamInterruptedError && error.reason === "network"
  );
}

async function sendRequest(
  request: ResponsesTransportRequest,
  accept: string
): Promise<{ response: Response; wired: WiredSignal }> {
  const fetchImpl = request.fetchImpl ?? fetch;
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const connectTimeoutMs = request.connectTimeoutMs ?? RESPONSES_CONNECT_TIMEOUT_MS;
  const maxAttempts = 1 + RESPONSES_NETWORK_RETRY_ATTEMPTS;
  for (let attempt = 0; ; attempt += 1) {
    const wired = wireSignal(request.signal, timeoutMs, connectTimeoutMs);
    try {
      const response = await fetchImpl(responsesUrl(request.baseUrl), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${request.apiKey}`,
          "Content-Type": "application/json",
          Accept: accept,
          ...request.headers,
        },
        body: JSON.stringify(request.body),
        signal: wired.signal,
      });
      wired.headersReceived();
      if (!response.ok) {
        try {
          throw await readHttpError(response);
        } finally {
          wired.cleanup();
        }
      }
      return { response, wired };
    } catch (error) {
      wired.cleanup();
      const translated = translateTransportError(error, wired.signal);
      if (
        attempt >= maxAttempts - 1 ||
        request.signal?.aborted ||
        !isRetryablePreHeadersFailure(translated)
      ) {
        throw translated;
      }
      // 指数退避：首次重试 400ms。退避期间调用方取消会在下一次尝试时经
      // wireSignal 立即中继为 AbortError。
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          RESPONSES_NETWORK_RETRY_BASE_DELAY_MS * 2 ** attempt
        )
      );
    }
  }
}

async function readHttpError(response: Response): Promise<ResponsesHttpError> {
  const body = await response.text().catch(() => "");
  return new ResponsesHttpError(
    response.status,
    body,
    response.status === 429 || response.status >= 500,
    parseRetryAfter(response.headers.get("retry-after"))
  );
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function isAbortError(error: unknown): boolean {
  // DOMException is realm-dependent (jsdom vs Node), so match on name.
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

function translateTransportError(error: unknown, signal?: AbortSignal): Error {
  if (signal?.aborted) {
    if (signal.reason instanceof ResponsesTimeoutError) return signal.reason;
    if (signal.reason instanceof ResponsesConnectTimeoutError) return signal.reason;
    return new DOMException("The operation was aborted", "AbortError");
  }
  if (
    error instanceof ResponsesTimeoutError ||
    error instanceof ResponsesConnectTimeoutError ||
    error instanceof ResponsesHttpError ||
    error instanceof ResponsesStreamInterruptedError
  ) {
    return error;
  }
  if (isAbortError(error)) {
    // Caller-driven aborts surface as plain AbortError; timeout aborts arrive
    // as the ResponsesTimeoutError used as the abort reason above.
    return error instanceof Error
      ? error
      : new DOMException("The operation was aborted", "AbortError");
  }
  return new ResponsesStreamInterruptedError(
    "network",
    error instanceof Error ? error.message : String(error),
    { cause: error }
  );
}

function parseEventData(data: string): ResponsesStreamEvent | undefined {
  const trimmed = data.trim();
  // No provider sends [DONE] on Responses; tolerate it so a proxy that
  // re-adds the sentinel cannot corrupt the tail of the stream.
  if (!trimmed || trimmed === "[DONE]") return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as { type?: unknown }).type === "string"
    ) {
      return parsed as ResponsesStreamEvent;
    }
    return undefined;
  } catch {
    // Keep the legacy SSE tolerance: a malformed line is skipped rather than
    // failing the whole stream.
    return undefined;
  }
}

async function* iterateSseEvents(
  response: Response,
  wired: WiredSignal
): AsyncGenerator<ResponsesStreamEvent> {
  const body = response.body;
  if (!body) {
    wired.cleanup();
    throw new ResponsesStreamInterruptedError(
      "network",
      "Responses API returned an empty stream body"
    );
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let dataLines: string[] = [];

  const dispatch = (): ResponsesStreamEvent | undefined => {
    if (dataLines.length === 0) return undefined;
    const data = dataLines.join("\n");
    dataLines = [];
    return parseEventData(data);
  };

  const handleLine = (rawLine: string): ResponsesStreamEvent | undefined => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line === "") return dispatch();
    if (line.startsWith(":")) return undefined; // comment / heartbeat
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^ /, ""));
      return undefined;
    }
    // `event:` / `id:` / `retry:` and unknown fields are ignored; the
    // Responses event type lives inside the JSON payload.
    return undefined;
  };

  try {
    while (true) {
      let next: ReadableStreamReadResult<Uint8Array>;
      try {
        next = await reader.read();
      } catch (error) {
        throw translateTransportError(error, wired.signal);
      }
      if (next.done) break;
      buffer += decoder.decode(next.value, { stream: true });
      const lines = buffer.split("\n");
      // The last element is an incomplete line and stays buffered until the
      // rest of it arrives in a later chunk.
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const event = handleLine(line);
        if (event) yield event;
      }
    }
    buffer += decoder.decode();
    if (buffer) {
      const event = handleLine(buffer);
      if (event) yield event;
    }
    // Flush a final event whose terminating blank line never arrived.
    const tail = dispatch();
    if (tail) yield tail;
  } finally {
    wired.cleanup();
    wired.cancel();
    try {
      await reader.cancel();
    } catch {
      // Best-effort cancellation: the reader may already be closed.
    }
    reader.releaseLock();
  }
}
