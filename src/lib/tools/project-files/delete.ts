import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { invalidateSearchCache } from "@/lib/cache/rag-search-cache";
import { invalidateFileSelectCache } from "@/lib/cache/rag-file-select-cache";

export async function deleteProjectFile(
  userId: string,
  projectId: string,
  fileId: string
): Promise<Record<string, unknown>> {
  const file = await prisma.fileAsset.findFirst({
    where: { id: fileId, userId, projectId },
    select: { id: true, originalName: true },
  });
  if (!file) {
    return { error: "NOT_FOUND" };
  }
  try {
    await prisma.fileAsset.delete({ where: { id: fileId } });
    await invalidateSearchCache(projectId);
    await invalidateFileSelectCache(projectId);
  } catch (error) {
    logger.error("delete file failed", { error: String(error), fileId });
    return { error: "DELETE_FAILED" };
  }
  return { deleted: true, id: file.id, name: file.originalName };
}