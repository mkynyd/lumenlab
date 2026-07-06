import { logger } from "@/lib/logger";
import { deleteFileAsset } from "@/lib/files/delete-file-asset";

export async function deleteProjectFile(
  userId: string,
  projectId: string,
  fileId: string
): Promise<Record<string, unknown>> {
  const result = await deleteFileAsset({
    fileAssetId: fileId,
    userId,
    projectId,
  });

  if (!result.deleted) {
    if (result.error === "NOT_FOUND") {
      return { error: "NOT_FOUND" };
    }
    logger.error("delete file failed", { error: result.error, fileId });
    return { error: "DELETE_FAILED" };
  }

  return {
    deleted: true,
    id: result.id,
    name: result.originalName,
  };
}
