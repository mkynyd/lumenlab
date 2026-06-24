import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

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
  } catch (error) {
    logger.error("delete file failed", { error: String(error), fileId });
    return { error: "DELETE_FAILED" };
  }
  return { deleted: true, id: file.id, name: file.originalName };
}