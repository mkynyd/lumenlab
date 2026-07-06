/**
 * 文件资产清理函数
 *
 * 被 API 路由和 Agent tool handler 共用，避免两处删除逻辑不一致。
 */

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  deleteStoredObject,
  type StorageProvider,
} from "@/lib/storage/object-storage";
import { deleteChunksByFileAsset } from "@/lib/rag/vector-store";
import { refreshProjectIndex } from "@/lib/rag/project-index";
import { invalidateSearchCache } from "@/lib/cache/rag-search-cache";
import { invalidateFileSelectCache } from "@/lib/cache/rag-file-select-cache";

export interface DeleteFileAssetResult {
  deleted: boolean;
  error?: string;
  id?: string;
  originalName?: string;
  projectId?: string | null;
}

export async function deleteFileAsset(params: {
  fileAssetId: string;
  userId: string;
  projectId?: string;
}): Promise<DeleteFileAssetResult> {
  const { fileAssetId, userId, projectId } = params;

  const file = await prisma.fileAsset.findFirst({
    where: {
      id: fileAssetId,
      userId,
      ...(projectId ? { projectId } : {}),
    },
    include: {
      resources: {
        select: { storageProvider: true, storagePath: true },
      },
    },
  });

  if (!file) {
    return { deleted: false, error: "NOT_FOUND" };
  }

  // 1. 删除向量 chunk
  await deleteChunksByFileAsset(file.id, userId);

  // 2. 删除原始对象存储
  await deleteStoredObject({
    provider: file.storageProvider as StorageProvider,
    key: file.storagePath,
  }).catch((error) => {
    logger.warn("文件对象删除失败", { fileId: file.id, error: String(error) });
  });

  // 3. 删除关联资源（如 PDF 解析出的图片）
  await Promise.all(
    file.resources.map((resource) =>
      deleteStoredObject({
        provider: resource.storageProvider as StorageProvider,
        key: resource.storagePath,
      }).catch((error) => {
        logger.warn("文件资源对象删除失败", {
          fileId: file.id,
          error: String(error),
        });
      })
    )
  );

  // 4. 删除数据库行
  await prisma.fileAsset.delete({ where: { id: file.id } });

  // 5. 刷新项目索引与缓存
  if (file.projectId) {
    await invalidateSearchCache(file.projectId);
    await invalidateFileSelectCache(file.projectId);
    await refreshProjectIndex({
      userId,
      projectId: file.projectId,
    }).catch(() => {});
  }

  return {
    deleted: true,
    id: file.id,
    originalName: file.originalName,
    projectId: file.projectId,
  };
}
