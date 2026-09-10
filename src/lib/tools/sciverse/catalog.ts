/**
 * Sciverse internal capability: /meta-catalog.
 *
 * Not registered as an Agent tool. Exists so platform code (and future
 * iterations) can learn the field catalog for a collection without
 * hardcoding field names — in particular the catalog-aware filter compiler in
 * `filter-compiler.ts`, which must never forward a model-chosen field.
 *
 * The catalog is a schema document, not evidence: it is cached in-process with
 * a bounded TTL and entry count, and it is never written into a Research
 * checkpoint or a model prompt.
 */

import { requestSciverse } from "./transport";
import type { SciverseCatalog, SciverseCatalogField } from "./types";

export type SciverseCatalogCollection = "papers" | "authors" | "sources";

export interface SciverseCatalogOptions {
  token: string;
  collection?: SciverseCatalogCollection;
  includeSampleValues?: boolean;
  includeFieldStats?: boolean;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

/** 静态 schema 在毫秒级返回；15 分钟 TTL 足够让 compiler 跟随上游字段变化。 */
export const SCIVERSE_CATALOG_TTL_MS = 15 * 60_000;
/** 上游 catalog 临时不可用时的负缓存窗口，避免每个 query 都打一次失败请求。 */
export const SCIVERSE_CATALOG_FAILURE_TTL_MS = 30_000;
/** 缓存条目上限（collection × sample/stats 组合），严格有界。 */
export const SCIVERSE_CATALOG_MAX_ENTRIES = 8;

function parseCatalog(payload: unknown): SciverseCatalog {
  const record = payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
  const fields: SciverseCatalogField[] = [];
  for (const raw of Array.isArray(record.fields) ? record.fields : []) {
    if (!raw || typeof raw !== "object") continue;
    const field = raw as Record<string, unknown>;
    if (typeof field.name !== "string" || !field.name) continue;
    fields.push({
      name: field.name,
      type: typeof field.type === "string" ? field.type : "String",
      filterable: field.filterable === true,
      sortable: field.sortable === true,
      searchable: field.searchable === true,
      default_returned: field.default_returned === true,
      ...(typeof field.description === "string" ? { description: field.description } : {}),
      ...(Array.isArray(field.sample_values)
        ? { sample_values: field.sample_values.filter((v): v is string | number | boolean =>
            typeof v === "string" || typeof v === "number" || typeof v === "boolean") }
        : {}),
      ...(Array.isArray(field.operators) ? { operators: field.operators as Array<string | { name?: string }> } : {}),
    });
  }
  return {
    fields,
    default_fields: Array.isArray(record.default_fields)
      ? record.default_fields.filter((v): v is string => typeof v === "string")
      : [],
    filter_operators: Array.isArray(record.filter_operators)
      ? (record.filter_operators as Array<string | { name?: string }>)
      : [],
  };
}

export async function listCatalog(options: SciverseCatalogOptions): Promise<SciverseCatalog> {
  const query: Record<string, string | number | boolean> = {
    collection: options.collection ?? "papers",
  };
  if (options.includeSampleValues) query.include_sample_values = true;
  if (options.includeFieldStats) query.include_field_stats = true;
  const payload = await requestSciverse<unknown>({
    method: "GET",
    path: "/meta-catalog",
    query,
    token: options.token,
    baseUrl: options.baseUrl,
    fetchImpl: options.fetchImpl,
    signal: options.signal,
  });
  return parseCatalog(payload);
}

// ─── Bounded in-process TTL cache ───────────────────────────────────────────

interface CatalogCacheEntry {
  catalog: SciverseCatalog | null;
  expiresAt: number;
}

const catalogCache = new Map<string, CatalogCacheEntry>();

function cacheKey(options: SciverseCatalogOptions): string {
  return [
    options.baseUrl ?? "",
    options.collection ?? "papers",
    options.includeSampleValues ? "1" : "0",
    options.includeFieldStats ? "1" : "0",
  ].join("|");
}

function remember(key: string, entry: CatalogCacheEntry): void {
  catalogCache.delete(key);
  catalogCache.set(key, entry);
  while (catalogCache.size > SCIVERSE_CATALOG_MAX_ENTRIES) {
    const oldest = catalogCache.keys().next().value;
    if (oldest === undefined) break;
    catalogCache.delete(oldest);
  }
}

/** 测试/运维用：清空进程内 catalog 缓存。 */
export function invalidateSciverseCatalogCache(): void {
  catalogCache.clear();
}

export interface CachedSciverseCatalog {
  catalog: SciverseCatalog | null;
  source: "live" | "cache" | "unavailable";
}

/**
 * Catalog lookup for the filter compiler. Never throws: a catalog outage
 * degrades to `{ catalog: null, source: "unavailable" }` so the caller can
 * drop advanced filters and keep the run alive.
 */
export async function getCachedCatalog(
  options: SciverseCatalogOptions & { now?: number }
): Promise<CachedSciverseCatalog> {
  const key = cacheKey(options);
  const now = options.now ?? Date.now();
  const cached = catalogCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.catalog ? { catalog: cached.catalog, source: "cache" } : { catalog: null, source: "unavailable" };
  }
  try {
    const catalog = await listCatalog(options);
    remember(key, { catalog, expiresAt: now + SCIVERSE_CATALOG_TTL_MS });
    return { catalog, source: "live" };
  } catch {
    remember(key, { catalog: null, expiresAt: now + SCIVERSE_CATALOG_FAILURE_TTL_MS });
    return { catalog: null, source: "unavailable" };
  }
}
