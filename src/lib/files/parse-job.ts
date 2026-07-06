import crypto from "crypto";
import path from "path";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getProviderApiKey } from "@/lib/data/provider-access";
import { createDocumentChunks } from "@/lib/rag/vector-store";
import {
  generateFileIndexMetadata,
  refreshProjectIndex,
} from "@/lib/rag/project-index";
import { logger } from "@/lib/logger";
import { embedChunksForFile } from "@/lib/rag/embedding";
import {
  readStoredObject,
  uploadObjectBuffer,
  deleteStoredObject,
  type StorageProvider,
} from "@/lib/storage/object-storage";
import type { ParsedImageAsset } from "@/lib/parse/mineru-result";
import { DocumentPipeline } from "@/lib/document-pipeline/pipeline";
import type { ParseInput } from "@/lib/document-pipeline/types";

export const PARSING_STAGES = {
  uploading: "上传文件中",
  converting: "转换格式中",
  pending: "排队等待中",
  model: "模型解析中",
  writing: "写入中",
  complete: "完成",
} as const;

function mergeMetadata(current: unknown, next: Record<string, unknown>): Prisma.InputJsonObject {
  return {
    ...(current && typeof current === "object"
      ? (current as Prisma.InputJsonObject)
      : {}),
    ...(next as Prisma.InputJsonObject),
  } as Prisma.InputJsonObject;
}

async function updateStage(
  file: { id: string; processingMetadata: unknown },
  stage: keyof typeof PARSING_STAGES,
  extra: Record<string, unknown> = {}
) {
  await prisma.fileAsset.update({
    where: { id: file.id },
    data: {
      status: stage === "complete" ? "parsed" : "parsing",
      processingMetadata: mergeMetadata(file.processingMetadata, {
        parsingStage: stage,
        parsingStageLabel: PARSING_STAGES[stage],
        ...extra,
      }),
    },
  });
}

async function getMiniMaxKey(userId: string) {
  try {
    return await getProviderApiKey(userId, "minimax");
  } catch {
    return undefined;
  }
}

async function getBailianKey(userId: string) {
  try {
    return await getProviderApiKey(userId, "bailian");
  } catch {
    return undefined;
  }
}

async function getMinerUToken(userId: string) {
  try {
    return await getProviderApiKey(userId, "mineru");
  } catch {
    return undefined;
  }
}

interface StoredFileAsset {
  id: string;
  relativePath: string;
  mimeType: string;
  size: number;
  storageProvider: StorageProvider;
  storagePath: string;
  resourceUrl: string;
}

async function storeFileAssets(input: {
  userId: string;
  fileAssetId: string;
  assets: ParsedImageAsset[];
}): Promise<StoredFileAsset[]> {
  const stored: StoredFileAsset[] = [];
  for (const asset of input.assets) {
    const id = crypto.randomUUID();
    const filename = path.posix.basename(asset.relativePath);
    const object = await uploadObjectBuffer({
      key: [
        "users",
        input.userId,
        "file-assets",
        input.fileAssetId,
        "resources",
        id,
        filename,
      ].join("/"),
      mimeType: asset.mimeType,
      buffer: asset.buffer,
    });
    stored.push({
      id,
      relativePath: asset.relativePath,
      mimeType: asset.mimeType,
      size: asset.buffer.length,
      storageProvider: object.provider,
      storagePath: object.key,
      resourceUrl: `/api/files/${input.fileAssetId}/resources/${id}`,
    });
  }
  return stored;
}

export async function parseFileContent(options: {
  userId: string;
  file: {
    id: string;
    originalName: string;
    mimeType: string;
    storageProvider: string;
    storagePath: string;
    processingMetadata: unknown;
  };
}) {
  const data = await readStoredObject({
    provider: options.file.storageProvider as StorageProvider,
    key: options.file.storagePath,
  });

  const parseInput: ParseInput = {
    userId: options.userId,
    fileAssetId: options.file.id,
    filename: options.file.originalName,
    mimeType: options.file.mimeType,
    data,
    apiKeys: {
      minimax: await getMiniMaxKey(options.userId),
      mineru: await getMinerUToken(options.userId),
      bailian: await getBailianKey(options.userId),
    },
  };

  await updateStage(options.file, "model", { parser: "document-pipeline" });

  const pipeline = new DocumentPipeline();
  const result = await pipeline.run(parseInput, (stage, progress) => {
    void updateStage(options.file, stage as keyof typeof PARSING_STAGES, {
      ...(progress ? { current: progress.current, total: progress.total } : {}),
    });
  });

  return {
    content: result.content,
    status: result.status,
    metadata: result.metadata,
    assets: result.assets,
  };
}

async function persistFileAssets(
  fileAssetId: string,
  userId: string,
  assets: { id: string; relativePath: string; mimeType: string; buffer: Buffer }[]
) {
  if (assets.length === 0) return [];

  const oldResources = await prisma.fileAssetResource.findMany({
    where: { fileAssetId },
    select: { id: true, storageProvider: true, storagePath: true },
  });
  if (oldResources.length > 0) {
    await Promise.all(
      oldResources.map((r) =>
        deleteStoredObject({
          provider: r.storageProvider as StorageProvider,
          key: r.storagePath,
        }).catch(() => {})
      )
    );
    await prisma.fileAssetResource.deleteMany({ where: { fileAssetId } });
  }

  const stored = await storeFileAssets({
    userId,
    fileAssetId,
    assets: assets.map((a) => ({
      relativePath: a.relativePath,
      mimeType: a.mimeType,
      buffer: a.buffer,
    })),
  });

  await prisma.fileAssetResource.createMany({
    data: stored.map((asset) => ({
      id: asset.id,
      fileAssetId,
      relativePath: asset.relativePath,
      mimeType: asset.mimeType,
      size: asset.size,
      storageProvider: asset.storageProvider,
      storagePath: asset.storagePath,
    })),
  });

  return stored;
}

export async function parseFileAsset(input: {
  userId: string;
  fileId: string;
}) {
  const file = await prisma.fileAsset.findFirst({
    where: { id: input.fileId, userId: input.userId },
  });
  if (!file) {
    throw new Error("文件不存在");
  }

  await updateStage(file, "uploading", {
    parseStartedAt: new Date().toISOString(),
    parseRunId: crypto.randomUUID(),
  });

  try {
    const result = await parseFileContent({
      userId: input.userId,
      file,
    });
    if (result.assets && result.assets.length > 0) {
      await persistFileAssets(file.id, input.userId, result.assets);
    }
    const indexMetadata = await generateFileIndexMetadata({
      userId: input.userId,
      filename: file.originalName,
      content: result.content,
    });
    const completedMetadata = {
      ...result.metadata,
      ...indexMetadata,
      parsingStage: "complete",
      parsingStageLabel: PARSING_STAGES.complete,
    };

    await updateStage(file, "writing", completedMetadata);

    await prisma.fileAsset.update({
      where: { id: file.id },
      data: {
        textContent: result.content,
        status: result.status,
        enhancementStatus: file.enhancedContent ? "stale" : "none",
        processingMetadata: mergeMetadata(file.processingMetadata, completedMetadata),
      },
    });

    let chunksCreated = false;
    try {
      await createDocumentChunks({
        fileAssetId: file.id,
        projectId: file.projectId,
        userId: input.userId,
        textContent: result.content,
        title: file.originalName,
      });
      chunksCreated = true;
    } catch {
      await prisma.fileAsset.update({
        where: { id: file.id },
        data: {
          processingMetadata: mergeMetadata(file.processingMetadata, {
            ...result.metadata,
            chunkWarning: "解析内容已保存，但检索分块创建失败",
          }),
        },
      });
    }

    if (chunksCreated) {
      const bailianKey = await getBailianKey(input.userId);
      if (bailianKey) {
        await embedChunksForFile({
          fileAssetId: file.id,
          apiKey: bailianKey,
        }).catch((error) => {
          logger.error("嵌入向量生成失败", {
            fileId: file.id,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
    }

    if (file.projectId) {
      await refreshProjectIndex({
        userId: input.userId,
        projectId: file.projectId,
      }).catch(() => {});
    }

    return {
      fileId: file.id,
      projectId: file.projectId,
      status: result.status,
      metadata: result.metadata,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "文件解析失败，请稍后重试";
    await prisma.fileAsset.update({
      where: { id: file.id },
      data: {
        status: "failed",
        processingMetadata: mergeMetadata(file.processingMetadata, {
          parseError: message.slice(0, 300),
          parsingStage: "failed",
          failedAt: new Date().toISOString(),
        }),
      },
    });
    if (file.projectId) {
      await refreshProjectIndex({
        userId: input.userId,
        projectId: file.projectId,
      }).catch(() => {});
    }
    throw error;
  }
}

export async function parseFileBatch(input: {
  userId: string;
  fileIds: string[];
}) {
  for (const fileId of [...new Set(input.fileIds)]) {
    try {
      await parseFileAsset({ userId: input.userId, fileId });
    } catch (error) {
      logger.error("文件解析任务失败", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export function startFileParseBatch(input: {
  userId: string;
  fileIds: string[];
}) {
  void parseFileBatch(input);
}
