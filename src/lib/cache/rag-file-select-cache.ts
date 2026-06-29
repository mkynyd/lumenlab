import { getRedis } from "@/lib/redis";
import {
  buildFileSelectCacheKey,
  buildIndexVersionKey,
} from "@/lib/cache/rag-cache-keys";
import { recordRagCacheResult } from "@/lib/cache/api-cache-metrics";

const FILE_SELECT_CACHE_TTL_SECONDS = 600;

export interface FileSelectionResult {
  fileIds: string[];
  source: "agentic-retrieval" | "index-fallback";
}

export async function getFileSelectCache(
  projectId: string,
  query: string
): Promise<FileSelectionResult | null> {
  try {
    const version =
      (await getRedis().get(buildIndexVersionKey(projectId))) || "0";
    const key = buildFileSelectCacheKey(projectId, version, query);
    const cached = await getRedis().get(key);
    if (!cached) return null;
    const parsed = JSON.parse(cached) as FileSelectionResult;
    await recordRagCacheResult("file-select", "hit");
    return parsed;
  } catch {
    return null;
  }
}

export async function setFileSelectCache(
  projectId: string,
  query: string,
  result: FileSelectionResult
): Promise<void> {
  try {
    const version =
      (await getRedis().get(buildIndexVersionKey(projectId))) || "0";
    const key = buildFileSelectCacheKey(projectId, version, query);
    await getRedis().setex(
      key,
      FILE_SELECT_CACHE_TTL_SECONDS,
      JSON.stringify(result)
    );
    await recordRagCacheResult("file-select", "miss");
  } catch {
    // Ignore.
  }
}

export async function invalidateFileSelectCache(
  projectId: string
): Promise<void> {
  try {
    await getRedis().incr(buildIndexVersionKey(projectId));
  } catch {
    // Ignore.
  }
}
