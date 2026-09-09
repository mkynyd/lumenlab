/**
 * Sciverse wire types and Agent-facing normalized types.
 *
 * Wire field names follow the native HTTP contract (snake_case); the official
 * tool-layer openapi.yaml is translated by their SDK, so LumenLab must emit
 * wire fields directly. Normalized types are what the Agent tools return.
 */

// ─── Wire: shared ───────────────────────────────────────────

export interface SciverseFieldFilter {
  field: string;
  operator:
    | "FILTER_OP_EQ"
    | "FILTER_OP_NE"
    | "FILTER_OP_GT"
    | "FILTER_OP_GTE"
    | "FILTER_OP_LT"
    | "FILTER_OP_LTE"
    | "FILTER_OP_IN"
    | "FILTER_OP_NIN"
    | "FILTER_OP_CONTAINS"
    | "FILTER_OP_MATCH"
    | "FILTER_OP_MATCH_PHRASE";
  value: unknown;
}

export type SciverseBoost = "NONE" | "MILD" | "STRONG";

export interface SciverseErrorBody {
  code?: string;
  message?: string;
  request_id?: string;
  details?: unknown;
}

// ─── Wire: /meta-search ─────────────────────────────────────

/** Author entry in meta-search results: tool contract says {name, orcid}
 * objects; the raw wire schema also allows plain strings. Both are accepted. */
export interface SciverseWireAuthor {
  name?: string;
  orcid?: string;
}

export interface SciverseWirePaper {
  unique_id?: string;
  doc_id?: string;
  title?: string;
  author?: Array<string | SciverseWireAuthor>;
  abstract?: string;
  doi?: string;
  publication_venue_name_unified?: string;
  publication_published_year?: number;
  citation_count?: number;
  influential_citation_count?: number;
  fwci?: number;
  access_is_oa?: boolean;
  access_oa_url?: string;
  access_oa_status?: string;
  language?: string;
  subjects?: string[];
  /** Injected server-side regardless of the fields projection. */
  is_content_accessible?: boolean;
}

export interface SciverseWireMetaSearchResponse {
  results?: SciverseWirePaper[];
  /** int64 may arrive as a string in protobuf JSON. */
  total_count?: number | string;
  page?: number;
  page_size?: number;
  total_pages?: number;
  next_cursor?: string;
  search_time_ms?: number;
}

// ─── Wire: /agentic-search ──────────────────────────────────

export interface SciverseWireAgenticFilters {
  lang?: string;
  author?: string | string[];
  publication_venue_name_unified?: string;
  publication_venue_type?: string;
  publication_published_year?: { gte?: number; lte?: number };
  publication_published_date?: { gte?: string; lte?: string };
  citation_count?: { gte?: number; lte?: number };
  influential_citation_count?: { gte?: number; lte?: number };
  topics?: {
    logic?: "and" | "or";
    dimensions?: { primary_topic?: string; primary_topic_domain?: string };
  };
  doc_id?: string[];
}

export interface SciverseWireAgenticHit {
  chunk_id?: string;
  doc_id?: string;
  title?: string;
  score?: number;
  offset?: number;
  chunk?: string;
  page_no?: number;
  source_type?: string;
  author?: string[];
  publication_venue_name_unified?: string;
  publication_published_year?: number;
}

export interface SciverseWireAgenticResponse {
  hits?: SciverseWireAgenticHit[];
}

// ─── Wire: /content ─────────────────────────────────────────

export interface SciverseWireContentResponse {
  text?: string;
  chars_returned?: number;
  bytes_returned?: number;
  text_length?: number;
  next_offset?: number;
  more?: boolean;
}

// ─── Wire: /meta-catalog ────────────────────────────────────

export interface SciverseCatalogField {
  name: string;
  type: string;
  filterable: boolean;
  sortable: boolean;
  searchable: boolean;
  default_returned: boolean;
  description?: string;
  sample_values?: Array<string | number | boolean>;
  operators?: Array<string | { name?: string }>;
}

export interface SciverseCatalog {
  fields: SciverseCatalogField[];
  default_fields: string[];
  filter_operators: Array<string | { name?: string }>;
}

// ─── Agent-facing input ─────────────────────────────────────

export type SciverseSortByYear = "auto" | "desc" | "asc" | "none";

export interface SciverseSearchInput {
  query?: string;
  titleContains?: string;
  abstractContains?: string;
  authors?: string[];
  journals?: string[];
  subjects?: string[];
  yearFrom?: number;
  yearTo?: number;
  freshnessBoost?: SciverseBoost;
  impactBoost?: SciverseBoost;
  languageAffinity?: SciverseBoost;
  sortByYear?: SciverseSortByYear;
  page?: number;
  pageSize?: number;
}

export type SciverseSemanticMode = "fast" | "balanced" | "quality";

export interface SciverseSemanticFiltersInput {
  lang?: string;
  author?: string | string[];
  venue?: string;
  venueType?: string;
  yearFrom?: number;
  yearTo?: number;
  dateFrom?: string;
  dateTo?: string;
  citationCountMin?: number;
  citationCountMax?: number;
  influentialCitationCountMin?: number;
  influentialCitationCountMax?: number;
  topicDomain?: string;
  primaryTopic?: string;
  /** The only hard constraint. An explicit empty array means an empty corpus. */
  docIds?: string[];
}

export interface SciverseSemanticInput {
  query: string;
  topK?: number;
  mode?: SciverseSemanticMode;
  sourceTypes?: string[];
  filters?: SciverseSemanticFiltersInput;
}

export interface SciverseReadInput {
  docId: string;
  offset?: number;
  limit?: number;
}

// ─── Agent-facing normalized output ─────────────────────────

export interface SciversePaperSummary {
  uniqueId: string;
  docId?: string;
  isContentAccessible: boolean;
  title: string;
  authors: string[];
  abstractPreview?: string;
  doi?: string;
  venue?: string;
  year?: number;
  citationCount?: number;
  influentialCitationCount?: number;
  fwci?: number;
  isOpenAccess?: boolean;
  url?: string;
}

export interface SciverseSearchResult {
  papers: SciversePaperSummary[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages?: number;
  hasMore: boolean;
}

export interface SciverseSemanticHit {
  chunkId: string;
  docId: string;
  title: string;
  score: number;
  offset: number;
  pageNo?: number;
  sourceType?: string;
  chunk?: string;
  authors?: string[];
  year?: number;
  venue?: string;
}

export interface SciverseSemanticResult {
  hits: SciverseSemanticHit[];
  count: number;
  query: string;
}

export interface SciverseReadResult {
  docId: string;
  offset: number;
  text: string;
  returnedChars?: number;
  totalLength?: number;
  nextOffset?: number;
  more: boolean;
}
