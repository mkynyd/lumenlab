import { createHash } from "node:crypto";
import { getRedis } from "@/lib/redis";

export type ExportFormat = "markdown" | "docx" | "pdf";

export function buildExportCacheKey(
  artifactId: string,
  format: ExportFormat,
  content: string
): string {
  const contentHash = createHash("sha256").update(content).digest("hex");
  return `export:${artifactId}:${format}:${contentHash}`;
}

export async function getCachedExport(key: string): Promise<Buffer | null> {
  try {
    const encoded = await getRedis().get(key);
    return encoded ? Buffer.from(encoded, "base64") : null;
  } catch {
    return null;
  }
}

export async function setCachedExport(
  key: string,
  content: Buffer
): Promise<void> {
  try {
    await getRedis().set(key, content.toString("base64"), "EX", 3600);
  } catch {
    // Export generation remains the fallback when Redis is unavailable.
  }
}

export async function recordExportCacheResult(
  format: ExportFormat,
  result: "hit" | "miss"
): Promise<void> {
  try {
    await getRedis().incr(`export:${format}:${result}`);
  } catch {
    // Metrics must never break downloads.
  }
}
