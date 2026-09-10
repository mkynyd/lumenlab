/**
 * Sciverse Agent tool handlers (the web/search.ts role for Sciverse).
 *
 * Each handler reads the platform-level SCIVERSE_API_TOKEN, normalizes and
 * validates arguments, calls the transport, and maps failures to stable
 * `{ error: "SCIVERSE_*" }` result objects — handlers never throw for
 * expected failure modes and never affect other tools. Logs carry only
 * endpoint/status/requestId/durationMs/kind; never the token, never the full
 * query text.
 */

import { logger } from "@/lib/logger";
import type { ToolExecutionContext } from "@/lib/agent/tool-executor";
import { SciverseError } from "./errors";
import {
  buildAgenticSearchRequest,
  buildMetaSearchRequest,
  buildPaperRelationsRequest,
  clampReadLimit,
  clampReadOffset,
  clampSearchPage,
  clampSearchPageSize,
  isSciverseBoost,
  isSciversePaperRelation,
  isSciverseSemanticMode,
  parseAgenticSearchResponse,
  parseContentResponse,
  parseMetaSearchResponse,
  parsePaperRelationsResponse,
  SCIVERSE_SEMANTIC_MAX_DOC_IDS,
  SCIVERSE_SEMANTIC_MAX_QUERY_CHARS,
} from "./normalize";
import { requestSciverse } from "./transport";
import type {
  SciversePaperRelationsInput,
  SciverseSearchInput,
  SciverseSemanticFiltersInput,
  SciverseWireAgenticResponse,
  SciverseWireContentResponse,
  SciverseWireMetaSearchResponse,
  SciverseWireRelationsResponse,
} from "./types";

type SciverseResult = Record<string, unknown>;

const NOT_CONFIGURED: SciverseResult = {
  error: "SCIVERSE_NOT_CONFIGURED",
  message: "平台学术检索未配置或暂不可用",
};

function readToken(): string | null {
  return process.env.SCIVERSE_API_TOKEN?.trim() || null;
}

function invalidRequest(message: string): SciverseResult {
  return { error: "SCIVERSE_INVALID_REQUEST", message };
}

function logFailure(endpoint: string, error: SciverseError, durationMs: number): void {
  const meta: Record<string, unknown> = {
    provider: "sciverse",
    endpoint,
    status: error.status,
    requestId: error.requestId,
    durationMs,
    kind: error.kind,
  };
  if (error.kind === "auth") logger.error("sciverse request failed", meta);
  else logger.warn("sciverse request failed", meta);
}

/** Maps a transport failure to a stable Agent-visible error object. */
function mapSciverseError(endpoint: string, error: SciverseError, durationMs: number): SciverseResult {
  logFailure(endpoint, error, durationMs);
  switch (error.kind) {
    case "auth":
      return { error: "SCIVERSE_AUTH_FAILED" };
    case "rate_limit":
      return {
        error: "SCIVERSE_RATE_LIMITED",
        ...(error.retryAfterMs != null ? { retryAfterMs: error.retryAfterMs } : {}),
      };
    case "not_found":
      return { error: "SCIVERSE_NOT_FOUND", recoverable: true };
    case "request":
      return { error: "SCIVERSE_INVALID_REQUEST", message: error.message };
    default:
      return { error: "SCIVERSE_UNAVAILABLE", recoverable: true };
  }
}

function asTrimmedString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text || undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return list.length ? [...new Set(list)] : undefined;
}

function asInteger(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : undefined;
}

export async function sciverseSearch(_ctx: ToolExecutionContext, args: Record<string, unknown>): Promise<SciverseResult> {
  const token = readToken();
  if (!token) return NOT_CONFIGURED;

  const boosts: Array<[keyof SciverseSearchInput, unknown]> = [
    ["freshnessBoost", args.freshnessBoost],
    ["impactBoost", args.impactBoost],
    ["languageAffinity", args.languageAffinity],
  ];
  for (const [key, value] of boosts) {
    // Invalid boost values are rejected outright: silently clamping to NONE
    // would hide a model-side contract mistake.
    if (value !== undefined && !isSciverseBoost(value)) {
      return invalidRequest(`${String(key)} 仅支持 NONE / MILD / STRONG`);
    }
  }
  if (args.sortByYear !== undefined && !["auto", "desc", "asc", "none"].includes(String(args.sortByYear))) {
    return invalidRequest("sortByYear 仅支持 auto / desc / asc / none");
  }

  const pageSize = clampSearchPageSize(args.pageSize);
  const input: SciverseSearchInput = {
    query: asTrimmedString(args.query),
    titleContains: asTrimmedString(args.titleContains),
    abstractContains: asTrimmedString(args.abstractContains),
    authors: asStringArray(args.authors),
    journals: asStringArray(args.journals),
    subjects: asStringArray(args.subjects),
    yearFrom: asInteger(args.yearFrom),
    yearTo: asInteger(args.yearTo),
    freshnessBoost: isSciverseBoost(args.freshnessBoost) ? args.freshnessBoost : undefined,
    impactBoost: isSciverseBoost(args.impactBoost) ? args.impactBoost : undefined,
    languageAffinity: isSciverseBoost(args.languageAffinity) ? args.languageAffinity : undefined,
    sortByYear: args.sortByYear as SciverseSearchInput["sortByYear"],
    page: clampSearchPage(args.page),
    pageSize,
  };

  const startedAt = Date.now();
  try {
    const payload = await requestSciverse<SciverseWireMetaSearchResponse>({
      method: "POST",
      path: "/meta-search",
      body: buildMetaSearchRequest(input),
      token,
      signal: _ctx.signal,
    });
    const result = parseMetaSearchResponse(payload, pageSize);
    logger.debug("sciverse meta-search ok", {
      provider: "sciverse",
      endpoint: "/meta-search",
      status: 200,
      results: result.papers.length,
      durationMs: Date.now() - startedAt,
    });
    return result as unknown as SciverseResult;
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    if (error instanceof SciverseError) return mapSciverseError("/meta-search", error, durationMs);
    logger.error("sciverse meta-search unexpected failure", { provider: "sciverse", endpoint: "/meta-search", durationMs });
    return { error: "SCIVERSE_UNAVAILABLE", recoverable: true };
  }
}

export async function sciverseSemanticSearch(_ctx: ToolExecutionContext, args: Record<string, unknown>): Promise<SciverseResult> {
  const token = readToken();
  if (!token) return NOT_CONFIGURED;

  const query = String(args.query ?? "").trim();
  if (!query) return invalidRequest("query 不能为空");
  if (args.mode !== undefined && !isSciverseSemanticMode(args.mode)) {
    return invalidRequest("mode 仅支持 fast / balanced / quality");
  }

  const filtersArg = args.filters && typeof args.filters === "object" && !Array.isArray(args.filters)
    ? (args.filters as Record<string, unknown>)
    : undefined;

  const docIds = asStringArray(filtersArg?.docIds);
  if (filtersArg && Array.isArray(filtersArg.docIds) && docIds === undefined) {
    // An explicit empty docIds array is an empty corpus: do not fall back to
    // a global search, and do not hit the network.
    return { hits: [], count: 0, query, scopedToEmptyCorpus: true };
  }
  if (docIds && docIds.length > SCIVERSE_SEMANTIC_MAX_DOC_IDS) {
    return {
      error: "SCIVERSE_SCOPE_TOO_LARGE",
      message: `docIds 去重后超过 ${SCIVERSE_SEMANTIC_MAX_DOC_IDS} 个上限`,
      docIds: docIds.length,
    };
  }

  const filters: SciverseSemanticFiltersInput | undefined = filtersArg
    ? {
        lang: asTrimmedString(filtersArg.lang),
        author: Array.isArray(filtersArg.author) ? asStringArray(filtersArg.author) : asTrimmedString(filtersArg.author),
        venue: asTrimmedString(filtersArg.venue),
        venueType: asTrimmedString(filtersArg.venueType),
        yearFrom: asInteger(filtersArg.yearFrom),
        yearTo: asInteger(filtersArg.yearTo),
        dateFrom: asTrimmedString(filtersArg.dateFrom),
        dateTo: asTrimmedString(filtersArg.dateTo),
        citationCountMin: asInteger(filtersArg.citationCountMin),
        citationCountMax: asInteger(filtersArg.citationCountMax),
        influentialCitationCountMin: asInteger(filtersArg.influentialCitationCountMin),
        influentialCitationCountMax: asInteger(filtersArg.influentialCitationCountMax),
        topicDomain: asTrimmedString(filtersArg.topicDomain),
        primaryTopic: asTrimmedString(filtersArg.primaryTopic),
        docIds,
      }
    : undefined;

  const startedAt = Date.now();
  try {
    const payload = await requestSciverse<SciverseWireAgenticResponse>({
      method: "POST",
      path: "/agentic-search",
      body: buildAgenticSearchRequest({
        query: query.slice(0, SCIVERSE_SEMANTIC_MAX_QUERY_CHARS),
        topK: args.topK as number | undefined,
        mode: isSciverseSemanticMode(args.mode) ? args.mode : undefined,
        sourceTypes: Array.isArray(args.sourceTypes)
          ? args.sourceTypes.filter((item): item is string => typeof item === "string")
          : undefined,
        filters,
      }),
      token,
      signal: _ctx.signal,
    });
    const result = parseAgenticSearchResponse(payload, query);
    logger.debug("sciverse agentic-search ok", {
      provider: "sciverse",
      endpoint: "/agentic-search",
      status: 200,
      results: result.count,
      durationMs: Date.now() - startedAt,
    });
    return result as unknown as SciverseResult;
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    if (error instanceof SciverseError) return mapSciverseError("/agentic-search", error, durationMs);
    logger.error("sciverse agentic-search unexpected failure", { provider: "sciverse", endpoint: "/agentic-search", durationMs });
    return { error: "SCIVERSE_UNAVAILABLE", recoverable: true };
  }
}

export async function sciversePaperRelations(_ctx: ToolExecutionContext, args: Record<string, unknown>): Promise<SciverseResult> {
  const token = readToken();
  if (!token) return NOT_CONFIGURED;

  const uniqueId = asTrimmedString(args.uniqueId);
  if (!uniqueId) return invalidRequest("uniqueId 不能为空（论文 unique_id，如 paper:10.1038/xxx；doc_id 无效）");
  if (!isSciversePaperRelation(args.relation)) {
    return invalidRequest("relation 仅支持 references / citations / related_works");
  }

  const input: SciversePaperRelationsInput = {
    uniqueId,
    relation: args.relation,
    page: typeof args.page === "number" ? args.page : undefined,
    pageSize: typeof args.pageSize === "number" ? args.pageSize : undefined,
  };

  const startedAt = Date.now();
  try {
    const payload = await requestSciverse<SciverseWireRelationsResponse>({
      method: "POST",
      path: "/meta-paper-relations",
      body: buildPaperRelationsRequest(input),
      token,
      signal: _ctx.signal,
    });
    const result = parsePaperRelationsResponse(payload, input);
    logger.debug("sciverse paper-relations ok", {
      provider: "sciverse",
      endpoint: "/meta-paper-relations",
      status: 200,
      results: result.items.length,
      durationMs: Date.now() - startedAt,
    });
    return result as unknown as SciverseResult;
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    if (error instanceof SciverseError) return mapSciverseError("/meta-paper-relations", error, durationMs);
    logger.error("sciverse paper-relations unexpected failure", { provider: "sciverse", endpoint: "/meta-paper-relations", durationMs });
    return { error: "SCIVERSE_UNAVAILABLE", recoverable: true };
  }
}

export async function sciverseRead(_ctx: ToolExecutionContext, args: Record<string, unknown>): Promise<SciverseResult> {
  const token = readToken();
  if (!token) return NOT_CONFIGURED;

  const docId = asTrimmedString(args.docId);
  if (!docId) return invalidRequest("docId 不能为空");
  const offset = clampReadOffset(args.offset);
  const limit = clampReadLimit(args.limit);

  const startedAt = Date.now();
  try {
    const payload = await requestSciverse<SciverseWireContentResponse>({
      method: "GET",
      path: "/content",
      query: { doc_id: docId, offset, limit },
      token,
      signal: _ctx.signal,
    });
    const result = parseContentResponse(payload, { docId, offset });
    if (!result.text.trim()) {
      // Full text not readable for this caller/document: structured,
      // recoverable state rather than a silent empty string.
      return {
        error: "SCIVERSE_CONTENT_UNAVAILABLE",
        recoverable: true,
        docId,
        offset,
      };
    }
    logger.debug("sciverse read ok", {
      provider: "sciverse",
      endpoint: "/content",
      status: 200,
      durationMs: Date.now() - startedAt,
    });
    return result as unknown as SciverseResult;
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    if (error instanceof SciverseError) {
      if (error.kind === "not_found") {
        logFailure("/content", error, durationMs);
        return { error: "SCIVERSE_CONTENT_UNAVAILABLE", recoverable: true, docId, offset };
      }
      return mapSciverseError("/content", error, durationMs);
    }
    logger.error("sciverse read unexpected failure", { provider: "sciverse", endpoint: "/content", durationMs });
    return { error: "SCIVERSE_UNAVAILABLE", recoverable: true };
  }
}
