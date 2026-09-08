/**
 * AnySearch transport. LumenLab owns the search stack (Tool Registry, audit,
 * cache, fallback), so this module speaks the AnySearch REST API directly
 * instead of routing search through a model provider or an MCP client.
 *
 * Official reference: POST https://api.anysearch.com/v1/search with
 * `Authorization: Bearer <ANYSEARCH_API_KEY>`. `max_results` is documented as
 * 1-10 and the service hard-caps the response at 10; requests are clamped here.
 */
const ANYSEARCH_ENDPOINT = "https://api.anysearch.com/v1/search";
const ANYSEARCH_TIMEOUT_MS = 8_000;
const ANYSEARCH_MAX_RETRY_WAIT_MS = 2_000;
const ANYSEARCH_RETRY_BACKOFF_MS = 300;

/** Official range. Do not raise this without re-checking the AnySearch docs. */
export const ANYSEARCH_MAX_RESULTS_LIMIT = 10;
export const ANYSEARCH_DEFAULT_MAX_RESULTS = 5;
const ZONES = ["cn", "intl"] as const;

export type AnySearchZone = (typeof ZONES)[number];

export interface AnySearchRequestOptions {
  query: string;
  maxResults?: number;
  tag?: string;
  zone?: AnySearchZone;
  language?: string;
  params?: Record<string, unknown>;
}

export interface AnySearchItem {
  title: string;
  url: string;
  snippet: string;
  content: string;
}

export interface AnySearchResponse {
  items: AnySearchItem[];
  requestId: string | null;
}

export type AnySearchFailureKind =
  | "request"
  | "auth"
  | "quota"
  | "rate_limit"
  | "server"
  | "network"
  | "response";

export class AnySearchError extends Error {
  constructor(
    readonly kind: AnySearchFailureKind,
    readonly status: number | null,
    message: string,
    readonly retryAfterMs: number | null = null
  ) {
    super(message);
    this.name = "AnySearchError";
  }
}

export function clampAnySearchMaxResults(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return ANYSEARCH_DEFAULT_MAX_RESULTS;
  return Math.min(ANYSEARCH_MAX_RESULTS_LIMIT, Math.max(1, Math.trunc(numeric)));
}

/** Only the documented wire fields are sent; camelCase never leaks to the API. */
export function buildAnySearchRequest(options: AnySearchRequestOptions): Record<string, unknown> {
  const body: Record<string, unknown> = {
    query: options.query,
    max_results: clampAnySearchMaxResults(options.maxResults),
  };
  const tag = options.tag?.trim();
  if (tag) body.tag = tag;
  if (options.zone && ZONES.includes(options.zone)) body.zone = options.zone;
  const language = options.language?.trim();
  if (language) body.language = language;
  if (options.params && typeof options.params === "object" && !Array.isArray(options.params) && Object.keys(options.params).length > 0) body.params = options.params;
  return body;
}

export function canonicalSearchUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.hostname || url.username || url.password) return null;
    url.hash = "";
    const path = url.pathname.replace(/\/+$/, "");
    return `${url.protocol}//${url.host.toLowerCase()}${path}${url.search}`;
  } catch {
    return null;
  }
}

/**
 * Structural validation and canonical de-duplication only. AnySearch already
 * applies its own routing/fusion/rerank, so no keyword relevance gate here.
 */
export function normalizeAnySearchItems(value: unknown, maxResults: number): AnySearchItem[] {
  const results = value && typeof value === "object" && !Array.isArray(value) && Array.isArray((value as { results?: unknown }).results)
    ? (value as { results: unknown[] }).results
    : [];
  const seen = new Set<string>();
  const items: AnySearchItem[] = [];
  for (const raw of results) {
    if (items.length >= maxResults) break;
    if (!raw || typeof raw !== "object") continue;
    const record = raw as Record<string, unknown>;
    const url = typeof record.url === "string" ? canonicalSearchUrl(record.url) : null;
    if (!url || seen.has(url)) continue;
    seen.add(url);
    items.push({
      title: typeof record.title === "string" && record.title.trim() ? record.title.trim() : url,
      url,
      snippet: typeof record.snippet === "string" ? record.snippet.trim() : "",
      content: typeof record.content === "string" ? record.content : "",
    });
  }
  return items;
}

export function parseAnySearchResponse(payload: unknown, requestedMaxResults?: number): AnySearchResponse {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new AnySearchError("response", null, "AnySearch 返回结构无法解析");
  const record = payload as Record<string, unknown>;
  if (record.code !== 0) throw new AnySearchError("response", null, `AnySearch 返回错误码 ${String(record.code)}：${String(record.message ?? "")}`.slice(0, 300));
  const data = record.data && typeof record.data === "object" && !Array.isArray(record.data) ? (record.data as Record<string, unknown>) : {};
  // Never return more than the caller asked for, even if metadata is missing.
  const limit = clampAnySearchMaxResults(requestedMaxResults ?? (data.metadata as { total_results?: unknown } | undefined)?.total_results);
  return {
    items: normalizeAnySearchItems(data, limit),
    requestId: typeof record.request_id === "string" ? record.request_id : null,
  };
}

function retryAfterMs(headers: Headers): number | null {
  const raw = headers.get("retry-after");
  if (raw) {
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
    const date = Date.parse(raw);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  const reset = Number(headers.get("x-ratelimit-reset"));
  if (Number.isFinite(reset) && reset > 0) {
    const delta = reset > 1_000_000_000 ? reset * 1_000 - Date.now() : reset * 1_000;
    if (delta > 0) return delta;
  }
  return null;
}

function classifyStatus(status: number): AnySearchFailureKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 402) return "quota";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "server";
  return "request";
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * One transport call with bounded retry. Never retries more than once and never
 * waits longer than the caller's step budget; every failure surfaces as an
 * AnySearchError so the orchestrator can fall back to Bing/DuckDuckGo.
 */
export async function requestAnySearch(input: AnySearchRequestOptions & {
  apiKey: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<AnySearchResponse> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const body = buildAnySearchRequest(input);
  const attempt = async (): Promise<Response> => {
    const timeout = AbortSignal.timeout(ANYSEARCH_TIMEOUT_MS);
    const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
    try {
      return await fetchImpl(ANYSEARCH_ENDPOINT, {
        method: "POST",
        headers: { authorization: `Bearer ${input.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (input.signal?.aborted) throw error;
      throw new AnySearchError("network", null, error instanceof Error ? error.message : "AnySearch 网络请求失败");
    }
  };

  let response: Response;
  try {
    response = await attempt();
  } catch (error) {
    const failure = error instanceof AnySearchError ? error : new AnySearchError("network", null, "AnySearch 网络请求失败");
    if (failure.kind === "network") {
      await sleep(ANYSEARCH_RETRY_BACKOFF_MS);
      try {
        response = await attempt();
      } catch (retryError) {
        throw retryError instanceof AnySearchError ? retryError : failure;
      }
    } else {
      throw failure;
    }
  }

  if (response.status === 429) {
    const wait = retryAfterMs(response.headers);
    if (wait !== null && wait <= ANYSEARCH_MAX_RETRY_WAIT_MS) {
      await sleep(wait);
      const retried = await attempt();
      if (retried.ok) return parseAnySearchResponse(await retried.json().catch(() => null), body.max_results as number);
      response = retried;
    }
  } else if (response.status >= 500) {
    await sleep(ANYSEARCH_RETRY_BACKOFF_MS);
    const retried = await attempt();
    if (retried.ok) return parseAnySearchResponse(await retried.json().catch(() => null));
    response = retried;
  }

  if (!response.ok) {
    const kind = classifyStatus(response.status);
    throw new AnySearchError(kind, response.status, `AnySearch HTTP ${response.status}`, kind === "rate_limit" ? retryAfterMs(response.headers) : null);
  }
  return parseAnySearchResponse(await response.json().catch(() => null), body.max_results as number);
}
