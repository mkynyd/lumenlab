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
 */
import type {
  ResponsesRequestBody,
  ResponsesResponsePayload,
  ResponsesStreamEvent,
} from "./types";

const DEFAULT_TIMEOUT_MS = 300_000;
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
}

function wireSignal(
  external: AbortSignal | undefined,
  timeoutMs: number
): WiredSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new ResponsesTimeoutError(timeoutMs));
  }, timeoutMs);
  (timer as unknown as { unref?: () => void }).unref?.();
  const relay = () => controller.abort(external?.reason);
  if (external?.aborted) relay();
  external?.addEventListener("abort", relay, { once: true });
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
      external?.removeEventListener("abort", relay);
    },
    cancel() {
      if (!controller.signal.aborted) {
        controller.abort(new DOMException("The operation was aborted", "AbortError"));
      }
    },
  };
}

function responsesUrl(baseUrl: string) {
  return `${baseUrl.replace(/\/+$/, "")}${RESPONSES_PATH}`;
}

async function sendRequest(
  request: ResponsesTransportRequest,
  accept: string
): Promise<{ response: Response; wired: WiredSignal }> {
  const fetchImpl = request.fetchImpl ?? fetch;
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const wired = wireSignal(request.signal, timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(responsesUrl(request.baseUrl), {
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
  } catch (error) {
    wired.cleanup();
    throw translateTransportError(error, wired.signal);
  }
  if (!response.ok) {
    try {
      throw await readHttpError(response);
    } finally {
      wired.cleanup();
    }
  }
  return { response, wired };
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
    return new DOMException("The operation was aborted", "AbortError");
  }
  if (
    error instanceof ResponsesTimeoutError ||
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
