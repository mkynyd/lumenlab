/**
 * Sciverse wire mapping and response normalization.
 *
 * Pure functions, no I/O. camelCase Agent arguments are translated to the
 * native wire contract here (the official SDK would do this translation, but
 * LumenLab speaks HTTP directly, so wire field names must be emitted):
 *
 * - meta-search convenience fields become FieldFilterItem entries; boosts pass
 *   through as snake_case enums; sort is only emitted when there is no query
 *   (upstream docs contradict themselves on query+sort, so we stay
 *   conservative) and an explicit/auto year direction applies.
 * - agentic-search `mode` never reaches the wire: fast → retrieval "es",
 *   balanced → retrieval "hybrid", quality → retrieval "hybrid" +
 *   sub_queries 3.
 */

import type {
  SciverseBoost,
  SciverseFieldFilter,
  SciversePaperRelationsInput,
  SciversePaperRelationsResult,
  SciversePaperRelation,
  SciversePaperSummary,
  SciverseReadResult,
  SciverseRelationItem,
  SciverseSearchInput,
  SciverseSearchResult,
  SciverseSemanticFiltersInput,
  SciverseSemanticHit,
  SciverseSemanticInput,
  SciverseSemanticResult,
  SciverseWireAgenticFilters,
  SciverseWireAgenticResponse,
  SciverseWireAuthor,
  SciverseWireContentResponse,
  SciverseWireMetaSearchResponse,
  SciverseWirePaper,
  SciverseWireRelationType,
  SciverseWireRelationsResponse,
} from "./types";

export const SCIVERSE_SEARCH_DEFAULT_PAGE_SIZE = 10;
export const SCIVERSE_SEARCH_MAX_PAGE_SIZE = 25;
export const SCIVERSE_SEMANTIC_DEFAULT_TOP_K = 10;
export const SCIVERSE_SEMANTIC_MAX_TOP_K = 100;
export const SCIVERSE_SEMANTIC_MAX_QUERY_CHARS = 4096;
export const SCIVERSE_SEMANTIC_MAX_DOC_IDS = 1000;
export const SCIVERSE_READ_DEFAULT_LIMIT = 1200;
export const SCIVERSE_READ_MAX_LIMIT = 4000;
/** paper_relations：Research 只需要小批量发现，默认 10、硬上限 50（上游允许 200，刻意收紧）。 */
export const SCIVERSE_RELATIONS_DEFAULT_PAGE_SIZE = 10;
export const SCIVERSE_RELATIONS_MAX_PAGE_SIZE = 50;
/** 上游在 page×page_size > 10000 时返回 400；这里的 clamp 使乘积远低于该阈值。 */
export const SCIVERSE_RELATIONS_MAX_PAGE = 20;
const ABSTRACT_PREVIEW_CHARS = 400;

/** Fixed meta-search projection: stable metadata for the Agent surface. */
export const SCIVERSE_SEARCH_FIELDS = [
  "unique_id",
  "doc_id",
  "title",
  "author",
  "abstract",
  "doi",
  "publication_venue_name_unified",
  "publication_published_year",
  "citation_count",
  "influential_citation_count",
  "fwci",
  "access_is_oa",
  "access_oa_url",
  "access_oa_status",
  "language",
  "subjects",
] as const;

const BOOSTS: readonly SciverseBoost[] = ["NONE", "MILD", "STRONG"];

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(numeric)));
}

export function clampSearchPage(value: unknown): number {
  return clampInt(value, 1, Number.MAX_SAFE_INTEGER, 1);
}

export function clampSearchPageSize(value: unknown): number {
  return clampInt(value, 1, SCIVERSE_SEARCH_MAX_PAGE_SIZE, SCIVERSE_SEARCH_DEFAULT_PAGE_SIZE);
}

export function clampSemanticTopK(value: unknown): number {
  return clampInt(value, 1, SCIVERSE_SEMANTIC_MAX_TOP_K, SCIVERSE_SEMANTIC_DEFAULT_TOP_K);
}

export function clampReadOffset(value: unknown): number {
  return clampInt(value, 0, Number.MAX_SAFE_INTEGER, 0);
}

export function clampReadLimit(value: unknown): number {
  return clampInt(value, 1, SCIVERSE_READ_MAX_LIMIT, SCIVERSE_READ_DEFAULT_LIMIT);
}

export function clampRelationsPage(value: unknown): number {
  return clampInt(value, 1, SCIVERSE_RELATIONS_MAX_PAGE, 1);
}

export function clampRelationsPageSize(value: unknown): number {
  return clampInt(value, 1, SCIVERSE_RELATIONS_MAX_PAGE_SIZE, SCIVERSE_RELATIONS_DEFAULT_PAGE_SIZE);
}

export function isSciverseBoost(value: unknown): value is SciverseBoost {
  return typeof value === "string" && (BOOSTS as readonly string[]).includes(value);
}

function cleanStringList(value: unknown, maxItems = 50): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const list: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    list.push(trimmed);
    if (list.length >= maxItems) break;
  }
  return list;
}

// ─── /meta-search request builder ───────────────────────────

export function buildMetaSearchRequest(input: SciverseSearchInput): Record<string, unknown> {
  const filters: SciverseFieldFilter[] = [];
  const titleContains = input.titleContains?.trim();
  if (titleContains) filters.push({ field: "title", operator: "FILTER_OP_CONTAINS", value: titleContains });
  const abstractContains = input.abstractContains?.trim();
  if (abstractContains) filters.push({ field: "abstract", operator: "FILTER_OP_CONTAINS", value: abstractContains });
  if (input.authors?.length) filters.push({ field: "author", operator: "FILTER_OP_IN", value: input.authors });
  if (input.yearFrom !== undefined) filters.push({ field: "publication_published_year", operator: "FILTER_OP_GTE", value: input.yearFrom });
  if (input.yearTo !== undefined) filters.push({ field: "publication_published_year", operator: "FILTER_OP_LTE", value: input.yearTo });
  if (input.journals?.length) filters.push({ field: "publication_venue_name_unified", operator: "FILTER_OP_IN", value: input.journals });
  if (input.subjects?.length) filters.push({ field: "subjects", operator: "FILTER_OP_IN", value: input.subjects });

  const query = input.query?.trim() || undefined;
  const page = clampSearchPage(input.page);
  const pageSize = clampSearchPageSize(input.pageSize);

  const body: Record<string, unknown> = {
    collection: "papers",
    page,
    page_size: pageSize,
    fields: [...SCIVERSE_SEARCH_FIELDS],
  };
  if (query) body.query = query;
  if (filters.length) body.filters = filters;

  // Sort is conservative: never combined with a query. "auto" resolves to a
  // year-descending sort only for query-less structured scans, where the
  // backend default order is effectively random (unique_id).
  const sortByYear = input.sortByYear ?? "auto";
  if (!query && sortByYear !== "none") {
    const direction = sortByYear === "asc" ? "SORT_ORDER_ASC" : "SORT_ORDER_DESC";
    body.sort = [{ field: "publication_published_year", order: direction }];
  }

  // Boosts pass through as snake_case enums; NONE is the server default, so
  // it is omitted to keep the payload minimal.
  if (input.freshnessBoost && input.freshnessBoost !== "NONE") body.freshness_boost = input.freshnessBoost;
  if (input.impactBoost && input.impactBoost !== "NONE") body.impact_boost = input.impactBoost;
  if (input.languageAffinity && input.languageAffinity !== "NONE") body.language_affinity = input.languageAffinity;

  return body;
}

// ─── /meta-search response parser ───────────────────────────

function extractAuthorNames(value: SciverseWirePaper["author"]): string[] {
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      if (entry.trim()) names.push(entry.trim());
    } else if (entry && typeof entry === "object") {
      const name = (entry as SciverseWireAuthor).name;
      if (typeof name === "string" && name.trim()) names.push(name.trim());
    }
  }
  return names;
}

function doiUrl(doi: string | undefined): string | undefined {
  const trimmed = doi?.trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://doi.org/${trimmed.replace(/^doi:\s*/i, "")}`;
}

export function parseMetaSearchResponse(
  payload: SciverseWireMetaSearchResponse,
  pageSize: number
): SciverseSearchResult {
  const records = Array.isArray(payload.results) ? payload.results : [];
  const papers: SciversePaperSummary[] = [];
  for (const record of records) {
    if (!record || typeof record !== "object") continue;
    const uniqueId = typeof record.unique_id === "string" ? record.unique_id.trim() : "";
    const title = typeof record.title === "string" ? record.title.trim() : "";
    if (!uniqueId || !title) continue;
    const docId = typeof record.doc_id === "string" && record.doc_id.trim() ? record.doc_id.trim() : undefined;
    const abstract = typeof record.abstract === "string" ? record.abstract.replace(/\s+/g, " ").trim() : "";
    const paper: SciversePaperSummary = {
      uniqueId,
      isContentAccessible: record.is_content_accessible === true,
      title,
      authors: extractAuthorNames(record.author),
      ...(docId ? { docId } : {}),
      ...(abstract ? { abstractPreview: abstract.slice(0, ABSTRACT_PREVIEW_CHARS) } : {}),
      ...(typeof record.doi === "string" && record.doi.trim() ? { doi: record.doi.trim() } : {}),
      ...(typeof record.publication_venue_name_unified === "string" && record.publication_venue_name_unified
        ? { venue: record.publication_venue_name_unified }
        : {}),
      ...(typeof record.publication_published_year === "number" ? { year: record.publication_published_year } : {}),
      ...(typeof record.citation_count === "number" ? { citationCount: record.citation_count } : {}),
      ...(typeof record.influential_citation_count === "number"
        ? { influentialCitationCount: record.influential_citation_count }
        : {}),
      ...(typeof record.fwci === "number" ? { fwci: record.fwci } : {}),
      ...(typeof record.access_is_oa === "boolean" ? { isOpenAccess: record.access_is_oa } : {}),
    };
    // URLs only come from real data: the OA location, or the DOI resolver.
    const url = typeof record.access_oa_url === "string" && record.access_oa_url.trim()
      ? record.access_oa_url.trim()
      : doiUrl(record.doi);
    if (url) paper.url = url;
    papers.push(paper);
  }

  const totalCountRaw = payload.total_count;
  const totalCount = typeof totalCountRaw === "number"
    ? totalCountRaw
    : typeof totalCountRaw === "string"
      ? Number(totalCountRaw)
      : papers.length;
  const page = typeof payload.page === "number" && payload.page >= 1 ? payload.page : 1;
  const totalPages = typeof payload.total_pages === "number" && payload.total_pages >= 0 ? payload.total_pages : undefined;
  const nextCursor = typeof payload.next_cursor === "string" ? payload.next_cursor.trim() : "";
  const hasMore = totalPages !== undefined ? page < totalPages : nextCursor.length > 0;

  return {
    papers,
    totalCount: Number.isFinite(totalCount) ? totalCount : papers.length,
    page,
    pageSize,
    ...(totalPages !== undefined ? { totalPages } : {}),
    hasMore,
  };
}

// ─── /agentic-search request builder ────────────────────────

const SEMANTIC_MODES = ["fast", "balanced", "quality"] as const;
const SOURCE_TYPES = ["web", "pdf"] as const;
const TOPIC_DOMAINS = ["Physical Sciences", "Social Sciences", "Health Sciences", "Life Sciences"] as const;

export function isSciverseSemanticMode(value: unknown): value is (typeof SEMANTIC_MODES)[number] {
  return typeof value === "string" && (SEMANTIC_MODES as readonly string[]).includes(value);
}

function rangeFilter(from: unknown, to: unknown): { gte?: number; lte?: number } | undefined {
  const gte = typeof from === "number" && Number.isFinite(from) ? Math.trunc(from) : undefined;
  const lte = typeof to === "number" && Number.isFinite(to) ? Math.trunc(to) : undefined;
  if (gte === undefined && lte === undefined) return undefined;
  return { ...(gte !== undefined ? { gte } : {}), ...(lte !== undefined ? { lte } : {}) };
}

function dateRangeFilter(from: unknown, to: unknown): { gte?: string; lte?: string } | undefined {
  const valid = (value: unknown): value is string =>
    typeof value === "string" && /^\d{4}(-\d{2})?(-\d{2})?$/.test(value.trim());
  const gte = valid(from) ? from.trim() : undefined;
  const lte = valid(to) ? to.trim() : undefined;
  if (!gte && !lte) return undefined;
  return { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) };
}

export function buildAgenticFilters(input: SciverseSemanticFiltersInput): SciverseWireAgenticFilters | undefined {
  const filters: SciverseWireAgenticFilters = {};
  const lang = input.lang?.trim();
  if (lang) filters.lang = lang;
  const authors = typeof input.author === "string" ? cleanStringList([input.author]) : cleanStringList(input.author);
  if (authors.length === 1) filters.author = authors[0];
  else if (authors.length > 1) filters.author = authors;
  const venue = input.venue?.trim();
  if (venue) filters.publication_venue_name_unified = venue;
  const venueType = input.venueType?.trim();
  if (venueType) filters.publication_venue_type = venueType;
  const year = rangeFilter(input.yearFrom, input.yearTo);
  if (year) filters.publication_published_year = year;
  const date = dateRangeFilter(input.dateFrom, input.dateTo);
  if (date) filters.publication_published_date = date;
  const citations = rangeFilter(input.citationCountMin, input.citationCountMax);
  if (citations) filters.citation_count = citations;
  const influential = rangeFilter(input.influentialCitationCountMin, input.influentialCitationCountMax);
  if (influential) filters.influential_citation_count = influential;
  const primaryTopic = input.primaryTopic?.trim();
  const topicDomain = input.topicDomain?.trim();
  if (primaryTopic || topicDomain) {
    filters.topics = {
      dimensions: {
        ...(primaryTopic ? { primary_topic: primaryTopic } : {}),
        ...(topicDomain && (TOPIC_DOMAINS as readonly string[]).includes(topicDomain)
          ? { primary_topic_domain: topicDomain }
          : {}),
      },
    };
  }
  if (input.docIds && input.docIds.length > 0) filters.doc_id = input.docIds;
  return Object.keys(filters).length > 0 ? filters : undefined;
}

export function buildAgenticSearchRequest(input: SciverseSemanticInput): Record<string, unknown> {
  const mode = input.mode ?? "balanced";
  const body: Record<string, unknown> = {
    query: input.query,
    top_k: clampSemanticTopK(input.topK),
    retrieval: mode === "fast" ? "es" : "hybrid",
  };
  if (mode === "quality") body.sub_queries = 3;
  const sourceTypes = (input.sourceTypes ?? []).filter((value): value is (typeof SOURCE_TYPES)[number] =>
    (SOURCE_TYPES as readonly string[]).includes(value)
  );
  if (sourceTypes.length) body.source_types = sourceTypes;
  const filters = input.filters ? buildAgenticFilters(input.filters) : undefined;
  if (filters) body.filters = filters;
  return body;
}

// ─── /agentic-search response parser ────────────────────────

export function parseAgenticSearchResponse(payload: SciverseWireAgenticResponse, query: string): SciverseSemanticResult {
  const rawHits = Array.isArray(payload.hits) ? payload.hits : [];
  const hits: SciverseSemanticHit[] = [];
  for (const raw of rawHits) {
    if (!raw || typeof raw !== "object") continue;
    // Hits without a stable chunk/doc identity are dropped.
    const chunkId = typeof raw.chunk_id === "string" ? raw.chunk_id.trim() : "";
    const docId = typeof raw.doc_id === "string" ? raw.doc_id.trim() : "";
    if (!chunkId || !docId) continue;
    hits.push({
      chunkId,
      docId,
      title: typeof raw.title === "string" ? raw.title : "",
      score: typeof raw.score === "number" && Number.isFinite(raw.score) ? raw.score : 0,
      offset: typeof raw.offset === "number" && Number.isFinite(raw.offset) ? raw.offset : 0,
      ...(typeof raw.page_no === "number" ? { pageNo: raw.page_no } : {}),
      ...(typeof raw.source_type === "string" && raw.source_type ? { sourceType: raw.source_type } : {}),
      ...(typeof raw.chunk === "string" && raw.chunk ? { chunk: raw.chunk } : {}),
      ...(Array.isArray(raw.author)
        ? { authors: raw.author.filter((a): a is string => typeof a === "string" && Boolean(a.trim())) }
        : {}),
      ...(typeof raw.publication_published_year === "number" ? { year: raw.publication_published_year } : {}),
      ...(typeof raw.publication_venue_name_unified === "string" && raw.publication_venue_name_unified
        ? { venue: raw.publication_venue_name_unified }
        : {}),
    });
  }
  return { hits, count: hits.length, query };
}

// ─── /content response parser ───────────────────────────────

export function parseContentResponse(
  payload: SciverseWireContentResponse,
  input: { docId: string; offset: number }
): SciverseReadResult {
  const text = typeof payload.text === "string" ? payload.text : "";
  // The three field names disagree across specs; accept chars_returned and
  // bytes_returned as the returned-length signal, text_length as the total.
  const returnedChars = typeof payload.chars_returned === "number"
    ? payload.chars_returned
    : typeof payload.bytes_returned === "number"
      ? payload.bytes_returned
      : undefined;
  return {
    docId: input.docId,
    offset: input.offset,
    text,
    ...(returnedChars !== undefined ? { returnedChars } : {}),
    ...(typeof payload.text_length === "number" ? { totalLength: payload.text_length } : {}),
    ...(typeof payload.next_offset === "number" ? { nextOffset: payload.next_offset } : {}),
    more: payload.more === true,
  };
}

// ─── /meta-paper-relations request builder / parser ─────────

const PAPER_RELATIONS: Record<SciversePaperRelation, SciverseWireRelationType> = {
  references: "REFERENCES",
  citations: "CITATIONS",
  related_works: "RELATED_WORKS",
};

export function isSciversePaperRelation(value: unknown): value is SciversePaperRelation {
  return typeof value === "string" && value in PAPER_RELATIONS;
}

export function buildPaperRelationsRequest(input: SciversePaperRelationsInput): Record<string, unknown> {
  return {
    unique_id: input.uniqueId,
    relation: PAPER_RELATIONS[input.relation],
    page: clampRelationsPage(input.page),
    page_size: clampRelationsPageSize(input.pageSize),
  };
}

export function parsePaperRelationsResponse(
  payload: SciverseWireRelationsResponse,
  input: SciversePaperRelationsInput,
): SciversePaperRelationsResult {
  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  const items: SciverseRelationItem[] = [];
  for (const raw of rawItems) {
    if (!raw || typeof raw !== "object") continue;
    // 没有稳定标识的条目直接丢弃；未知 id_type 原样保留（provider-scoped），
    // 由上层决定如何 canonicalize，绝不在此臆造 DOI。
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    if (!id) continue;
    const item: SciverseRelationItem = {
      id,
      idType: typeof raw.id_type === "string" && raw.id_type.trim() ? raw.id_type.trim() : "unknown",
    };
    if (typeof raw.title === "string" && raw.title.trim()) item.title = raw.title.trim();
    items.push(item);
  }
  const totalCountRaw = payload.total_count;
  const totalCount = typeof totalCountRaw === "number"
    ? totalCountRaw
    : typeof totalCountRaw === "string"
      ? Number(totalCountRaw)
      : items.length;
  const page = typeof payload.page === "number" && payload.page >= 1 ? payload.page : clampRelationsPage(input.page);
  const pageSize = clampRelationsPageSize(input.pageSize);
  const totalPages = typeof payload.total_pages === "number" && payload.total_pages >= 0 ? payload.total_pages : undefined;
  return {
    uniqueId: input.uniqueId,
    relation: input.relation,
    items,
    totalCount: Number.isFinite(totalCount) ? totalCount : items.length,
    page,
    pageSize,
    ...(totalPages !== undefined ? { totalPages } : {}),
    hasMore: totalPages !== undefined ? page < totalPages : items.length >= pageSize,
  };
}
