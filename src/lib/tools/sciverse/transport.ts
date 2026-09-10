/**
 * Sciverse HTTP transport.
 *
 * Pure transport: base URL assembly, Bearer auth, bounded timeout, a fixed
 * bounded retry policy, and error-body parsing. No logging here — the handler
 * layer owns logs. Request-body construction and response normalization live
 * in normalize.ts; this module only speaks HTTP.
 *
 * Wire facts (docs/SciverseAPI.json):
 * - Base URL https://api.sciverse.space (env override for tests/migration).
 * - Error body { code, message, request_id?, details? }; 429 may carry a
 *   Retry-After header in seconds or details.retry_after.
 */

import { SciverseError, type SciverseErrorKind } from "./errors";
import type { SciverseErrorBody } from "./types";

export const SCIVERSE_DEFAULT_BASE_URL = "https://api.sciverse.space";
const SCIVERSE_TIMEOUT_MS = 8_000;
const SCIVERSE_RETRY_BACKOFF_MS = 300;

/** Retry once only for these transient statuses; everything else fails fast. */
const RETRYABLE_STATUSES = new Set([500, 502, 503, 504, 507]);

export interface SciverseRequestOptions {
  method: "GET" | "POST";
  path: string;
  body?: Record<string, unknown>;
  query?: Record<string, string | number | boolean>;
  token: string;
  /** Explicit override wins over SCIVERSE_API_BASE_URL (tests / migration). */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

export function resolveSciverseBaseUrl(override?: string): string {
  const candidate = override?.trim() || process.env.SCIVERSE_API_BASE_URL?.trim() || SCIVERSE_DEFAULT_BASE_URL;
  return candidate.replace(/\/+$/, "");
}

function classifyStatus(status: number): SciverseErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "server";
  return "request";
}

function retryAfterMs(headers: Headers, details: unknown): number | null {
  const raw = headers.get("retry-after");
  if (raw) {
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
    const date = Date.parse(raw);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  if (details && typeof details === "object" && !Array.isArray(details)) {
    const retryAfter = Number((details as { retry_after?: unknown }).retry_after);
    if (Number.isFinite(retryAfter) && retryAfter >= 0) return retryAfter * 1_000;
  }
  return null;
}

async function parseErrorBody(response: Response): Promise<SciverseErrorBody> {
  const payload = await response.json().catch(() => null);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const outer = payload as Record<string, unknown>;
  // 上游有两种错误外壳：扁平的 {code,message,request_id} 与嵌套的
  // {error:{biz_code,code,message}}（后者用于业务错误，例如 EMPTY_RESULT）。
  const nested = outer.error && typeof outer.error === "object" && !Array.isArray(outer.error)
    ? outer.error as Record<string, unknown>
    : {};
  const record = typeof outer.code === "string" ? outer : nested;
  return {
    code: typeof record.code === "string" ? record.code : undefined,
    message: typeof record.message === "string" ? record.message : undefined,
    request_id: typeof outer.request_id === "string" ? outer.request_id : undefined,
    details: outer.details ?? nested.biz_code,
  };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * One Sciverse call with a bounded retry: 429 never retries immediately;
 * transient 5xx and network errors retry exactly once after a short backoff;
 * 400/401/403/404 never retry. The token is only placed in the Authorization
 * header and never appears in error messages.
 */
export async function requestSciverse<T>(options: SciverseRequestOptions): Promise<T> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = resolveSciverseBaseUrl(options.baseUrl);
  const url = new URL(`${baseUrl}${options.path}`);
  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      url.searchParams.set(key, String(value));
    }
  }
  const endpoint = url.toString();

  const attempt = async (): Promise<Response> => {
    const timeout = AbortSignal.timeout(SCIVERSE_TIMEOUT_MS);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    try {
      return await fetchImpl(endpoint, {
        method: options.method,
        headers: {
          authorization: `Bearer ${options.token}`,
          ...(options.body ? { "content-type": "application/json" } : {}),
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
        signal,
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw new SciverseError(
        "network",
        null,
        error instanceof Error ? error.message : "Sciverse 网络请求失败"
      );
    }
  };

  let response: Response;
  try {
    response = await attempt();
  } catch (error) {
    const failure = error instanceof SciverseError ? error : new SciverseError("network", null, "Sciverse 网络请求失败");
    if (failure.kind !== "network") throw failure;
    await sleep(SCIVERSE_RETRY_BACKOFF_MS);
    try {
      response = await attempt();
    } catch (retryError) {
      throw retryError instanceof SciverseError ? retryError : failure;
    }
  }

  if (!response.ok && RETRYABLE_STATUSES.has(response.status)) {
    await sleep(SCIVERSE_RETRY_BACKOFF_MS);
    response = await attempt();
  }

  if (!response.ok) {
    const body = await parseErrorBody(response);
    const kind = classifyStatus(response.status);
    const label = `Sciverse HTTP ${response.status}${body.code ? ` ${body.code}` : ""}`;
    throw new SciverseError(
      kind,
      response.status,
      body.message ? `${label}: ${body.message}` : label,
      body.code,
      body.request_id,
      kind === "rate_limit" ? retryAfterMs(response.headers, body.details) : null
    );
  }

  const payload = await response.json().catch(() => null);
  if (payload === null || typeof payload !== "object") {
    throw new SciverseError("response", response.status, "Sciverse 返回结构无法解析");
  }
  return payload as T;
}

/**
 * Binary variant of `requestSciverse` for `/resource`, which returns an image
 * stream instead of JSON. Same auth, timeout, bounded retry and error
 * normalization; the body is capped by `maxBytes` so a hostile or oversized
 * asset can never be buffered without a bound.
 */
export async function requestSciverseBinary(options: {
  path: string;
  query: Record<string, string | number | boolean>;
  token: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  maxBytes: number;
}): Promise<{ bytes: Buffer; mimeType: string | null }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = resolveSciverseBaseUrl(options.baseUrl);
  const url = new URL(`${baseUrl}${options.path}`);
  for (const [key, value] of Object.entries(options.query)) {
    url.searchParams.set(key, String(value));
  }
  const endpoint = url.toString();

  const attempt = async (): Promise<Response> => {
    const timeout = AbortSignal.timeout(SCIVERSE_TIMEOUT_MS);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    try {
      return await fetchImpl(endpoint, {
        method: "GET",
        headers: { authorization: `Bearer ${options.token}` },
        signal,
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw new SciverseError("network", null, error instanceof Error ? error.message : "Sciverse 网络请求失败");
    }
  };

  let response: Response;
  try {
    response = await attempt();
  } catch (error) {
    const failure = error instanceof SciverseError ? error : new SciverseError("network", null, "Sciverse 网络请求失败");
    if (failure.kind !== "network") throw failure;
    await sleep(SCIVERSE_RETRY_BACKOFF_MS);
    try {
      response = await attempt();
    } catch (retryError) {
      throw retryError instanceof SciverseError ? retryError : failure;
    }
  }

  if (!response.ok && RETRYABLE_STATUSES.has(response.status)) {
    await sleep(SCIVERSE_RETRY_BACKOFF_MS);
    response = await attempt();
  }

  if (!response.ok) {
    // The body is an error document, not an image; reuse the JSON error path.
    const body = await parseErrorBody(response);
    const kind = classifyStatus(response.status);
    const label = `Sciverse HTTP ${response.status}${body.code ? ` ${body.code}` : ""}`;
    throw new SciverseError(
      kind,
      response.status,
      body.message ? `${label}: ${body.message}` : label,
      body.code,
      body.request_id,
      kind === "rate_limit" ? retryAfterMs(response.headers, body.details) : null
    );
  }

  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > options.maxBytes) {
    throw new SciverseError("response", response.status, "Sciverse 资源超过大小上限");
  }
  const raw = Buffer.from(await response.arrayBuffer());
  if (raw.length > options.maxBytes) {
    throw new SciverseError("response", response.status, "Sciverse 资源超过大小上限");
  }
  return { bytes: raw, mimeType: response.headers.get("content-type") };
}
