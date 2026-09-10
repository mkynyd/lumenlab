/**
 * Catalog-aware Sciverse filter compiler.
 *
 * Boundary (deliberate): a model may only submit a *high-level filter intent* —
 * a closed set of typed keys such as `openAccess` or `languages`. It never
 * submits a raw field name, an operator, or wire JSON, and it never sees the
 * catalog. The server maps each intent key to a canonical field + operator,
 * validates that pair against the live `/meta-catalog` response, clamps every
 * value, and only then emits `filters` entries for `/meta-search`.
 *
 * Wire fact (verified against the live API on 2026-09-11): the native HTTP
 * contract has exactly ONE array named `filters`. `filters_advanced` from the
 * official tool-layer openapi.yaml is an SDK convenience alias and is rejected
 * with `400 INVALID_REQUEST` when sent on the wire. Advanced fields therefore
 * compile into the same `filters` array as the typed convenience filters.
 *
 * Degradation: if the catalog is unavailable, advanced filters are dropped
 * entirely (never sent unvalidated) and the caller keeps the typed basic
 * filters + query. A catalog-driven drop never fails the Research Run.
 */

import type { SciverseCatalog, SciverseCatalogField, SciverseFieldFilter } from "./types";

/** 单次请求最多编译出的 advanced filter 条数（严格有界）。 */
export const SCIVERSE_MAX_ADVANCED_FILTERS = 6;
/** filters 总数上限（typed basic + advanced）。 */
export const SCIVERSE_MAX_TOTAL_FILTERS = 10;
/** 单个字符串值长度上限。 */
export const SCIVERSE_MAX_FILTER_STRING_CHARS = 120;
/** IN/NIN 数组元素上限。 */
export const SCIVERSE_MAX_FILTER_ARRAY_ITEMS = 6;
const MIN_PUBLICATION_YEAR = 1600;
const MAX_PUBLICATION_YEAR = 2100;
const MAX_CITATION_BOUND = 10_000_000;
const MAX_FWCI_BOUND = 100_000;
const MAX_REFERENCE_BOUND = 1_000_000;

/**
 * 高层 filter intent：封闭键集。未知键一律拒绝，避免模型用任意键探测上游 schema。
 */
export interface SciverseFilterIntent {
  /** 是否开放获取（access_is_oa）。 */
  openAccess?: boolean;
  /** OA 状态（access_oa_status），如 gold / hybrid / bronze / green / closed / diamond。 */
  oaStatus?: string[];
  /** 发表载体类型（publication_venue_type）。 */
  venueTypes?: string[];
  /** 资源/文献类型（type），如 article / review / preprint。 */
  publicationTypes?: string[];
  /** 元数据类型（metadata_type）：paper / ebook。 */
  resourceTypes?: string[];
  /** 语言代码（language），如 en / zh。 */
  languages?: string[];
  /** 出版方（publication_publisher）。 */
  publishers?: string[];
  /** 关键词（keywords，MATCH 模糊匹配）。 */
  keywords?: string[];
  /** DOI 精确匹配（服务端归一化）。 */
  doi?: string;
  /** 引文反查：引用该 unique_id 的论文（references_unique_id）。 */
  citedBy?: string;
  /** 引用分位（citation_normalized_percentile.is_in_top_*）。 */
  topPercentile?: "top_1_percent" | "top_10_percent";
  citationCountMin?: number;
  citationCountMax?: number;
  influentialCitationCountMin?: number;
  influentialCitationCountMax?: number;
  fwciMin?: number;
  fwciMax?: number;
  referenceCountMin?: number;
  referenceCountMax?: number;
  /** 发表日期下界（publication_published_date，YYYY-MM-DD）。 */
  publishedFrom?: string;
  /** 发表日期上界（publication_published_date，YYYY-MM-DD）。 */
  publishedTo?: string;
}

export const SCIVERSE_FILTER_INTENT_KEYS: readonly (keyof SciverseFilterIntent)[] = [
  "openAccess",
  "oaStatus",
  "venueTypes",
  "publicationTypes",
  "resourceTypes",
  "languages",
  "publishers",
  "keywords",
  "doi",
  "citedBy",
  "topPercentile",
  "citationCountMin",
  "citationCountMax",
  "influentialCitationCountMin",
  "influentialCitationCountMax",
  "fwciMin",
  "fwciMax",
  "referenceCountMin",
  "referenceCountMax",
  "publishedFrom",
  "publishedTo",
];

export type SciverseCatalogSource = "live" | "cache" | "unavailable";

export interface AppliedSciverseFilter {
  /** 命中的 intent 键。 */
  key: keyof SciverseFilterIntent;
  /** 服务器决定的 catalog 字段名。 */
  field: string;
  operator: SciverseFieldFilter["operator"];
}

export interface DroppedSciverseFilter {
  key: keyof SciverseFilterIntent;
  reason:
    | "unknown_field"
    | "not_filterable"
    | "unsupported_operator"
    | "type_mismatch"
    | "invalid_value"
    | "filter_budget_exceeded"
    | "catalog_unavailable";
}

export interface CompiledSciverseFilters {
  /** 可直接合并进 /meta-search `filters` 的条目。 */
  filters: SciverseFieldFilter[];
  applied: AppliedSciverseFilter[];
  dropped: DroppedSciverseFilter[];
  catalog: SciverseCatalogSource;
}

const EMPTY_COMPILED: CompiledSciverseFilters = { filters: [], applied: [], dropped: [], catalog: "unavailable" };

// ─── Categorical value allowlists ───────────────────────────────────────────
// Kept intentionally narrow: these mirror the values the upstream catalog
// publishes as `sample_values`. Values are still catalog-validated at compile
// time; the allowlist keeps a model from smuggling arbitrary text into an
// IN filter where a small enum is expected.

const OA_STATUS_VALUES = new Set(["closed", "green", "gold", "bronze", "hybrid", "diamond"]);
const VENUE_TYPE_VALUES = new Set([
  "journal",
  "conference",
  "repository",
  "book series",
  "ebook platform",
  "metadata",
  "raidregistry",
  "igsncatalog",
  "other",
]);
const RESOURCE_TYPE_VALUES = new Set(["paper", "ebook"]);
const PUBLICATION_TYPE_VALUES = new Set([
  "article",
  "review",
  "study",
  "book",
  "book-chapter",
  "clinical-trial",
  "conference",
  "case-report",
  "letter",
  "preprint",
  "editorial",
  "other",
  "report",
  "thesis",
  "paratext",
  "dataset",
  "new-results",
  "news",
  "correction",
  "standard",
]);
const LANGUAGE_PATTERN = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i;
const DOI_PATTERN = /^10\.\d{4,9}\/\S{1,120}$/;
const SCIVERSE_UNIQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/#-]{2,180}$/;
const DATE_PATTERN = /^\d{4}(-\d{2})?(-\d{2})?$/;

function clampString(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > SCIVERSE_MAX_FILTER_STRING_CHARS) return null;
  // Control characters and quote/backslash smuggling never reach the wire.
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  return trimmed;
}

function clampStringList(value: readonly string[], predicate?: (item: string) => boolean): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const cleaned = clampString(item);
    if (!cleaned) continue;
    if (predicate && !predicate(cleaned)) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(cleaned);
    if (output.length >= SCIVERSE_MAX_FILTER_ARRAY_ITEMS) break;
  }
  return output;
}

function clampNumber(value: number, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < min || value > max) return null;
  return Number.isInteger(value) ? value : Math.round(value * 1000) / 1000;
}

function clampDate(value: string): string | null {
  const cleaned = clampString(value);
  if (!cleaned || !DATE_PATTERN.test(cleaned)) return null;
  const year = Number(cleaned.slice(0, 4));
  if (year < MIN_PUBLICATION_YEAR || year > MAX_PUBLICATION_YEAR) return null;
  return cleaned;
}

// ─── Intent shape validation (strict, model-facing contract) ────────────────

export type FilterIntentParseResult =
  | { ok: true; intent: SciverseFilterIntent }
  | { ok: false; message: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Strict shape validation. Anything that is not a known key of the closed
 * intent contract is rejected outright (a model-side contract mistake must be
 * visible, not silently dropped), while *catalog-level* mismatches are handled
 * by `compileSciverseFilterIntent` as bounded degradation.
 */
export function parseSciverseFilterIntent(value: unknown): FilterIntentParseResult {
  if (value === undefined || value === null) return { ok: true, intent: {} };
  if (!isPlainObject(value)) return { ok: false, message: "filterIntent 必须是对象" };

  const unknownKeys = Object.keys(value).filter(
    (key) => !(SCIVERSE_FILTER_INTENT_KEYS as readonly string[]).includes(key)
  );
  if (unknownKeys.length > 0) {
    return { ok: false, message: `filterIntent 含未知字段：${unknownKeys.slice(0, 5).join(", ")}` };
  }

  for (const key of ["oaStatus", "venueTypes", "publicationTypes", "resourceTypes", "languages", "publishers", "keywords"] as const) {
    const raw = value[key];
    if (raw === undefined) continue;
    if (!Array.isArray(raw) || raw.some((item) => typeof item !== "string")) {
      return { ok: false, message: `filterIntent.${key} 必须是字符串数组` };
    }
  }
  for (const key of ["doi", "citedBy", "publishedFrom", "publishedTo", "topPercentile"] as const) {
    const raw = value[key];
    if (raw === undefined) continue;
    if (typeof raw !== "string") return { ok: false, message: `filterIntent.${key} 必须是字符串` };
  }
  if (value.openAccess !== undefined && typeof value.openAccess !== "boolean") {
    return { ok: false, message: "filterIntent.openAccess 必须是布尔值" };
  }
  if (value.topPercentile !== undefined && value.topPercentile !== "top_1_percent" && value.topPercentile !== "top_10_percent") {
    return { ok: false, message: "filterIntent.topPercentile 仅支持 top_1_percent / top_10_percent" };
  }
  for (const key of [
    "citationCountMin",
    "citationCountMax",
    "influentialCitationCountMin",
    "influentialCitationCountMax",
    "fwciMin",
    "fwciMax",
    "referenceCountMin",
    "referenceCountMax",
  ] as const) {
    const raw = value[key];
    if (raw === undefined) continue;
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      return { ok: false, message: `filterIntent.${key} 必须是有限数字` };
    }
  }
  return { ok: true, intent: value as SciverseFilterIntent };
}

// ─── Catalog validation ─────────────────────────────────────────────────────

/** 目录里表达“可筛选”的类型族。未知类型不静默放行。 */
type CatalogTypeFamily = "string" | "number" | "boolean" | "date" | "array" | "object";

export function catalogTypeFamily(rawType: string): CatalogTypeFamily | null {
  const type = rawType.trim();
  if (/^List\[/i.test(type) || /\[\]$/.test(type)) return "array";
  switch (type.toLowerCase()) {
    case "string":
      return "string";
    case "integer":
    case "int":
    case "long":
    case "float":
    case "double":
    case "number":
      return "number";
    case "boolean":
    case "bool":
      return "boolean";
    case "date":
    case "datetime":
      return "date";
    case "object":
      return "object";
    default:
      return null;
  }
}

function normalizeOperatorName(raw: unknown): string | null {
  if (typeof raw === "string") return raw.trim().toUpperCase();
  if (isPlainObject(raw) && typeof raw.name === "string") return raw.name.trim().toUpperCase();
  return null;
}

function fieldOperators(field: SciverseCatalogField): Set<string> {
  const raw = Array.isArray(field.operators) ? field.operators : [];
  const names = raw.flatMap((entry) => {
    const name = normalizeOperatorName(entry);
    return name ? [name] : [];
  });
  return new Set(names.map((name) => (name.startsWith("FILTER_OP_") ? name : `FILTER_OP_${name}`)));
}

interface CompiledEntry {
  key: keyof SciverseFilterIntent;
  field: string;
  operator: SciverseFieldFilter["operator"];
  expect: CatalogTypeFamily;
  value: unknown;
}

interface FilterSpec {
  key: keyof SciverseFilterIntent;
  /** 服务器决定的 canonical catalog 字段名（模型不能提供）。 */
  field: string;
  operator: SciverseFieldFilter["operator"];
  expect: CatalogTypeFamily;
}

const SPECS: readonly FilterSpec[] = [
  { key: "openAccess", field: "access_is_oa", operator: "FILTER_OP_EQ", expect: "string" },
  { key: "oaStatus", field: "access_oa_status", operator: "FILTER_OP_IN", expect: "string" },
  { key: "venueTypes", field: "publication_venue_type", operator: "FILTER_OP_IN", expect: "string" },
  { key: "publicationTypes", field: "type", operator: "FILTER_OP_IN", expect: "array" },
  { key: "resourceTypes", field: "metadata_type", operator: "FILTER_OP_IN", expect: "string" },
  { key: "languages", field: "language", operator: "FILTER_OP_IN", expect: "string" },
  { key: "publishers", field: "publication_publisher", operator: "FILTER_OP_IN", expect: "array" },
  { key: "keywords", field: "keywords", operator: "FILTER_OP_MATCH", expect: "array" },
  { key: "doi", field: "doi", operator: "FILTER_OP_EQ", expect: "string" },
  // 上游 catalog 对 references_unique_id 只提供 IN/NIN/CONTAINS（无 EQ）。
  { key: "citedBy", field: "references_unique_id", operator: "FILTER_OP_IN", expect: "array" },
  { key: "topPercentile", field: "", operator: "FILTER_OP_EQ", expect: "boolean" },
  { key: "citationCountMin", field: "citation_count", operator: "FILTER_OP_GTE", expect: "number" },
  { key: "citationCountMax", field: "citation_count", operator: "FILTER_OP_LTE", expect: "number" },
  { key: "influentialCitationCountMin", field: "influential_citation_count", operator: "FILTER_OP_GTE", expect: "number" },
  { key: "influentialCitationCountMax", field: "influential_citation_count", operator: "FILTER_OP_LTE", expect: "number" },
  { key: "fwciMin", field: "fwci", operator: "FILTER_OP_GTE", expect: "number" },
  { key: "fwciMax", field: "fwci", operator: "FILTER_OP_LTE", expect: "number" },
  { key: "referenceCountMin", field: "reference_count", operator: "FILTER_OP_GTE", expect: "number" },
  { key: "referenceCountMax", field: "reference_count", operator: "FILTER_OP_LTE", expect: "number" },
  { key: "publishedFrom", field: "publication_published_date", operator: "FILTER_OP_GTE", expect: "date" },
  { key: "publishedTo", field: "publication_published_date", operator: "FILTER_OP_LTE", expect: "date" },
];

/** 把 intent 归一化为候选条目（尚未做 catalog 校验）。非法值在此丢弃。 */
function toCompiledEntries(intent: SciverseFilterIntent): { entries: CompiledEntry[]; dropped: DroppedSciverseFilter[] } {
  const entries: CompiledEntry[] = [];
  const dropped: DroppedSciverseFilter[] = [];
  const push = (entry: CompiledEntry) => entries.push(entry);

  for (const spec of SPECS) {
    const raw = intent[spec.key];
    if (raw === undefined) continue;
    switch (spec.key) {
      case "openAccess": {
        if (typeof raw !== "boolean") {
          dropped.push({ key: spec.key, reason: "invalid_value" });
          break;
        }
        push({ key: spec.key, field: spec.field, operator: spec.operator, expect: spec.expect, value: raw ? "true" : "false" });
        break;
      }
      case "oaStatus":
      case "venueTypes":
      case "resourceTypes":
      case "publicationTypes":
      case "languages": {
        const predicate =
          spec.key === "oaStatus"
            ? (item: string) => OA_STATUS_VALUES.has(item.toLowerCase())
            : spec.key === "venueTypes"
              ? (item: string) => VENUE_TYPE_VALUES.has(item.toLowerCase())
              : spec.key === "resourceTypes"
                ? (item: string) => RESOURCE_TYPE_VALUES.has(item.toLowerCase())
                : spec.key === "publicationTypes"
                  ? (item: string) => PUBLICATION_TYPE_VALUES.has(item.toLowerCase())
                  : (item: string) => LANGUAGE_PATTERN.test(item);
        const list = clampStringList(raw as string[], predicate);
        if (list.length === 0) {
          dropped.push({ key: spec.key, reason: "invalid_value" });
          break;
        }
        push({ key: spec.key, field: spec.field, operator: spec.operator, expect: spec.expect, value: list });
        break;
      }
      case "publishers": {
        const list = clampStringList(raw as string[]);
        if (list.length === 0) {
          dropped.push({ key: spec.key, reason: "invalid_value" });
          break;
        }
        push({ key: spec.key, field: spec.field, operator: spec.operator, expect: spec.expect, value: list });
        break;
      }
      case "keywords": {
        const list = clampStringList(raw as string[]);
        if (list.length === 0) {
          dropped.push({ key: spec.key, reason: "invalid_value" });
          break;
        }
        push({ key: spec.key, field: spec.field, operator: spec.operator, expect: spec.expect, value: list });
        break;
      }
      case "doi": {
        const cleaned = (clampString(String(raw)) ?? "")
          .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
          .replace(/^doi:\s*/i, "");
        if (!cleaned || !DOI_PATTERN.test(cleaned)) {
          dropped.push({ key: spec.key, reason: "invalid_value" });
          break;
        }
        push({ key: spec.key, field: spec.field, operator: spec.operator, expect: spec.expect, value: cleaned });
        break;
      }
      case "citedBy": {
        const cleaned = clampString(String(raw));
        if (!cleaned || !SCIVERSE_UNIQUE_ID_PATTERN.test(cleaned)) {
          dropped.push({ key: spec.key, reason: "invalid_value" });
          break;
        }
        push({ key: spec.key, field: spec.field, operator: spec.operator, expect: spec.expect, value: [cleaned] });
        break;
      }
      case "topPercentile": {
        if (raw !== "top_1_percent" && raw !== "top_10_percent") {
          dropped.push({ key: spec.key, reason: "invalid_value" });
          break;
        }
        push({
          key: spec.key,
          field: `citation_normalized_percentile.is_in_${raw === "top_1_percent" ? "top_1_percent" : "top_10_percent"}`,
          operator: spec.operator,
          expect: spec.expect,
          value: true,
        });
        break;
      }
      case "citationCountMin":
      case "citationCountMax":
      case "influentialCitationCountMin":
      case "influentialCitationCountMax": {
        const value = clampNumber(raw as number, 0, MAX_CITATION_BOUND);
        if (value === null) {
          dropped.push({ key: spec.key, reason: "invalid_value" });
          break;
        }
        push({ key: spec.key, field: spec.field, operator: spec.operator, expect: spec.expect, value });
        break;
      }
      case "fwciMin":
      case "fwciMax": {
        const value = clampNumber(raw as number, 0, MAX_FWCI_BOUND);
        if (value === null) {
          dropped.push({ key: spec.key, reason: "invalid_value" });
          break;
        }
        push({ key: spec.key, field: spec.field, operator: spec.operator, expect: spec.expect, value });
        break;
      }
      case "referenceCountMin":
      case "referenceCountMax": {
        const value = clampNumber(raw as number, 0, MAX_REFERENCE_BOUND);
        if (value === null) {
          dropped.push({ key: spec.key, reason: "invalid_value" });
          break;
        }
        push({ key: spec.key, field: spec.field, operator: spec.operator, expect: spec.expect, value });
        break;
      }
      case "publishedFrom":
      case "publishedTo": {
        const value = clampDate(String(raw));
        if (!value) {
          dropped.push({ key: spec.key, reason: "invalid_value" });
          break;
        }
        push({ key: spec.key, field: spec.field, operator: spec.operator, expect: spec.expect, value });
        break;
      }
      default:
        break;
    }
  }
  return { entries, dropped };
}

/**
 * Compiles a high-level filter intent into validated wire filters.
 *
 * `catalog` is the live/cached `/meta-catalog` payload. When it is null the
 * compiler refuses to emit anything: unvalidated advanced filters must never be
 * forwarded upstream (the API answers 400 INVALID_REQUEST for unknown or
 * non-filterable fields, which would silently kill the whole channel).
 */
export function compileSciverseFilterIntent(
  intent: SciverseFilterIntent | undefined,
  catalog: SciverseCatalog | null,
  catalogSource: SciverseCatalogSource,
  options: { maxFilters?: number } = {}
): CompiledSciverseFilters {
  if (!intent || Object.keys(intent).length === 0) {
    return { filters: [], applied: [], dropped: [], catalog: catalogSource };
  }
  const maxFilters = Math.max(0, options.maxFilters ?? SCIVERSE_MAX_ADVANCED_FILTERS);
  const { entries, dropped } = toCompiledEntries(intent);
  if (!catalog) {
    return {
      filters: [],
      applied: [],
      dropped: [...dropped, ...entries.map((entry) => ({ key: entry.key, reason: "catalog_unavailable" as const }))],
      catalog: "unavailable",
    };
  }

  const byName = new Map<string, SciverseCatalogField>();
  for (const field of catalog.fields) byName.set(field.name.toLowerCase(), field);

  const filters: SciverseFieldFilter[] = [];
  const applied: AppliedSciverseFilter[] = [];
  for (const entry of entries) {
    if (filters.length >= maxFilters) {
      dropped.push({ key: entry.key, reason: "filter_budget_exceeded" });
      continue;
    }
    const field = byName.get(entry.field.toLowerCase());
    if (!field) {
      dropped.push({ key: entry.key, reason: "unknown_field" });
      continue;
    }
    if (!field.filterable) {
      dropped.push({ key: entry.key, reason: "not_filterable" });
      continue;
    }
    const declared = catalogTypeFamily(field.type);
    if (!declared || declared !== entry.expect) {
      dropped.push({ key: entry.key, reason: "type_mismatch" });
      continue;
    }
    const operators = fieldOperators(field);
    if (operators.size > 0 && !operators.has(entry.operator)) {
      dropped.push({ key: entry.key, reason: "unsupported_operator" });
      continue;
    }
    filters.push({ field: field.name, operator: entry.operator, value: entry.value });
    applied.push({ key: entry.key, field: field.name, operator: entry.operator });
  }
  return { filters, applied, dropped, catalog: catalogSource };
}

/**
 * Drops typed basic filters whose field the catalog marks as missing or not
 * filterable. The basic filter set is generated by this repository (never by a
 * model), so only field eligibility is re-checked here — operators and values
 * are already fixed by the builder. When the catalog is unavailable the basic
 * set is passed through unchanged (current production behaviour).
 */
export function validateBasicSciverseFilters(
  filters: SciverseFieldFilter[],
  catalog: SciverseCatalog | null
): { filters: SciverseFieldFilter[]; dropped: string[] } {
  if (!catalog || filters.length === 0) return { filters, dropped: [] };
  const byName = new Map<string, SciverseCatalogField>();
  for (const field of catalog.fields) byName.set(field.name.toLowerCase(), field);
  const kept: SciverseFieldFilter[] = [];
  const dropped: string[] = [];
  for (const filter of filters) {
    const field = byName.get(filter.field.toLowerCase());
    if (!field || !field.filterable) {
      dropped.push(filter.field);
      continue;
    }
    kept.push(filter);
  }
  return { filters: kept, dropped };
}

/** Small, bounded provenance block for tool results / Research evidence. */
export function describeCompiledSciverseFilters(compiled: CompiledSciverseFilters): Record<string, unknown> {
  if (compiled.applied.length === 0 && compiled.dropped.length === 0) {
    return {};
  }
  return {
    catalog: compiled.catalog,
    applied: compiled.applied.map((entry) => ({ key: entry.key, field: entry.field, operator: entry.operator })),
    ...(compiled.dropped.length > 0 ? { dropped: compiled.dropped.slice(0, 12) } : {}),
  };
}

export { EMPTY_COMPILED as EMPTY_COMPILED_SCIVERSE_FILTERS };
