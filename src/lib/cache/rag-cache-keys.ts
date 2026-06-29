import { createHash } from "node:crypto";

export function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ").toLowerCase().slice(0, 400);
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function buildSearchCacheKey(
  projectId: string,
  version: string,
  query: string,
  fileScopeIds?: string[]
): string {
  const normalized = normalizeQuery(query);
  const scopePart =
    fileScopeIds && fileScopeIds.length > 0
      ? ":" + [...fileScopeIds].sort().join(",")
      : ":all";
  const hash = sha256(`${normalized}${scopePart}`);
  return `rag:search:v1:${projectId}:${version}:${hash}`;
}

export function buildFileSelectCacheKey(
  projectId: string,
  version: string,
  query: string
): string {
  const hash = sha256(normalizeQuery(query));
  return `rag:file-select:v1:${projectId}:${version}:${hash}`;
}

export function buildQueryEmbedCacheKey(query: string): string {
  const hash = sha256(normalizeQuery(query));
  return `rag:query-embed:v1:${hash}`;
}

export function buildSearchVersionKey(projectId: string): string {
  return `rag:search-version:${projectId}`;
}

export function buildIndexVersionKey(projectId: string): string {
  return `rag:index-version:${projectId}`;
}
