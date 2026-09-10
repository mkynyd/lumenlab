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

// ─── Wire: /meta-paper-relations ────────────────────────────

/** Wire enum is UPPER_SNAKE; the Agent-facing contract uses lower_snake. */
export type SciverseWireRelationType = "CITATIONS" | "REFERENCES" | "RELATED_WORKS";

export interface SciverseWireRelationItem {
  id?: string;
  id_type?: string;
  title?: string;
}

export interface SciverseWireRelationsResponse {
  items?: SciverseWireRelationItem[];
  /** int64 may arrive as a string in protobuf JSON. */
  total_count?: number | string;
  page?: number;
  page_size?: number;
  total_pages?: number;
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
  /**
   * 服务器编译出的 advanced filters（catalog 校验后）。模型永远不提供字段名或
   * 操作符，只提供高层 filter intent。
   */
  advancedFilters?: SciverseFieldFilter[];
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

// ─── Agent-facing: paper resources (figures / tables) ───────

/** 正文 Markdown 中 `![alt](file_name)` 形式的图片占位。 */
export interface SciverseResourceRef {
  /** 上游相对路径（来自 Markdown url 段）。 */
  fileName: string;
  /** Markdown alt 文本；上游常为空。 */
  alt?: string;
  /** 占位符周围的有界正文上下文（图注通常紧邻图片）。 */
  context?: string;
  /** 由 alt/周围文本确定性推断的资源类型，不做语义猜测。 */
  kind: "figure" | "table" | "image";
}

export interface SciverseResourceInput {
  /** 文献 doc_id；仅用于 provenance 与归属校验，不是上游参数。 */
  docId?: string;
  /** 相对路径，来自 sciverse.read 返回的 resources[].fileName。 */
  fileName: string;
}

export interface SciverseResourceResult {
  fileName: string;
  mimeType: string;
  byteLength: number;
  /** base64 编码的图片字节（有界，超出上限时省略）。 */
  dataBase64?: string;
  /** 二进制持久化/交付状态；超限或被截断时为 false。 */
  dataIncluded: boolean;
  docId?: string;
}

// ─── Agent-facing: paper relations ──────────────────────────

/**
 * 论文 ↔ 论文的 scholarly relation（与 Claim ↔ Evidence 的 ClaimEvidenceRelation、
 * Paper Schema 内部 entity relation 是三种完全不同的“关系”）。
 */
export type SciversePaperRelation = "references" | "citations" | "related_works";

export interface SciversePaperRelationsInput {
  /** 论文 unique_id（如 paper:10.1038/xxx）；doc_id 无效。 */
  uniqueId: string;
  relation: SciversePaperRelation;
  page?: number;
  pageSize?: number;
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
  /**
   * 服务器编译出的 advanced filter provenance（catalog 校验结果）。
   * 模型只看到摘要，不看到 catalog 原文；Research 会把它写进 Evidence provenance。
   */
  advancedFilters?: SciverseAdvancedFilterProvenance;
}

export interface SciverseAdvancedFilterProvenance {
  catalog: "live" | "cache" | "unavailable";
  applied: Array<{ key: string; field: string; operator: string }>;
  dropped?: Array<{ key: string; reason: string }>;
  /** 被 catalog 判定为不可筛选而剔除的 typed basic filter 字段。 */
  basicDroppedFields?: string[];
  /** advanced filters 返回空结果后是否发生了一次受控 relaxed retry。 */
  relaxedRetry?: boolean;
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
  /** 本片段 Markdown 中出现的图片占位（有界），供 sciverse.resource 使用。 */
  resources?: SciverseResourceRef[];
}

export interface SciverseRelationItem {
  id: string;
  idType: string;
  title?: string;
}

export interface SciversePaperRelationsResult {
  uniqueId: string;
  relation: SciversePaperRelation;
  items: SciverseRelationItem[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages?: number;
  hasMore: boolean;
}
