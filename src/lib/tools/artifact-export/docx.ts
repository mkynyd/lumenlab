/** Word tool returns a small download reference; binary data stays out of model context. */
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { markdownToDocx } from "@/lib/export/markdown-to-docx";
import { safeExportFilename } from "@/lib/export/filename";
import { buildExportCacheKey, getCachedExport, setCachedExport } from "@/lib/cache/export-cache";

export async function exportArtifactAsDocx(userId: string, artifactId: string): Promise<Record<string, unknown>> {
  const artifact = await prisma.artifact.findFirst({
    where: { id: artifactId, userId },
    select: { id: true, title: true, content: true, type: true },
  });
  if (!artifact) return { error: "ARTIFACT_NOT_FOUND" };
  try {
    const key = buildExportCacheKey(artifact.id, "docx", artifact.content);
    let buffer = await getCachedExport(key);
    if (!buffer) {
      buffer = await markdownToDocx(artifact.content);
      await setCachedExport(key, buffer);
    }
    return {
      artifactId: artifact.id,
      title: artifact.title,
      format: "docx",
      filename: safeExportFilename(artifact.title, "docx"),
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      downloadUrl: `/api/artifacts/${encodeURIComponent(artifact.id)}/export?format=docx`,
      bytes: buffer.byteLength,
    };
  } catch (error) {
    logger.error("docx export failed", { error: String(error) });
    return { error: "EXPORT_FAILED" };
  }
}
