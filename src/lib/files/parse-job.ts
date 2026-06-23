import crypto from "crypto";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getProviderApiKey } from "@/lib/data/provider-access";
import { createDocumentChunks } from "@/lib/rag/vector-store";
import {
  generateFileIndexMetadata,
  refreshProjectIndex,
} from "@/lib/rag/project-index";
import { logger } from "@/lib/logger";
import {
  parseImageWithMiniMax,
  parseDocumentWithMiniMax,
} from "@/lib/vision/minimax";
import { embedChunksForFile } from "@/lib/rag/embedding";
import { readStoredObject, type StorageProvider } from "@/lib/storage/object-storage";

export const PARSING_STAGES = {
  uploading: "上传文件中",
  converting: "转换格式中",
  pending: "排队等待中",
  model: "模型解析中",
  writing: "写入中",
  complete: "完成",
} as const;

const TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
  "csv",
  "json",
  "ts",
  "tsx",
  "js",
  "jsx",
  "py",
  "c",
  "cpp",
  "h",
  "java",
  "sql",
  "html",
  "css",
]);

const PDF_EXTENSIONS = new Set(["pdf"]);

const UNSUPPORTED_OFFICE_EXTENSIONS = new Set([
  "ppt",
  "pptx",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "wps",
  "et",
  "dps",
  "pages",
  "numbers",
  "key",
]);

const IMAGE_MEDIA_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function mergeMetadata(current: unknown, next: Record<string, unknown>): Prisma.InputJsonObject {
  return {
    ...(current && typeof current === "object"
      ? (current as Prisma.InputJsonObject)
      : {}),
    ...(next as Prisma.InputJsonObject),
  } as Prisma.InputJsonObject;
}

function extensionOf(filename: string) {
  const index = filename.lastIndexOf(".");
  return index >= 0 ? filename.slice(index + 1).toLowerCase() : "";
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

type MiniMaxImageMedia = "image/png" | "image/jpeg" | "image/webp";

function imageMediaType(mimeType: string): MiniMaxImageMedia | null {
  if ((IMAGE_MEDIA_TYPES as Set<string>).has(mimeType)) {
    return mimeType as MiniMaxImageMedia;
  }
  return null;
}

async function parseFileContent(options: {
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
  const ext = extensionOf(options.file.originalName || options.file.storagePath);
  const data = await readStoredObject({
    provider: options.file.storageProvider as StorageProvider,
    key: options.file.storagePath,
  });

  if (TEXT_EXTENSIONS.has(ext)) {
    return {
      content: data.toString("utf-8"),
      status: "parsed" as const,
      metadata: {
        parser: "text-local",
        parsedAt: new Date().toISOString(),
      },
    };
  }

  if (UNSUPPORTED_OFFICE_EXTENSIONS.has(ext)) {
    throw new Error("暂不支持 Office 格式直接解析，请先转换为 PDF 后再上传");
  }

  if (!PDF_EXTENSIONS.has(ext) && options.file.mimeType !== "application/pdf") {
    const imageType = imageMediaType(options.file.mimeType);
    if (!imageType) {
      throw new Error(`不支持的文件类型: .${ext || options.file.mimeType}`);
    }

    const apiKey = await getMiniMaxKey(options.userId);
    if (!apiKey) {
      throw new Error("尚未配置 MiniMax API Key，请先在设置中添加");
    }

    await updateStage(options.file, "model", { parser: "minimax-m3-image" });
    const content = await parseImageWithMiniMax({
      apiKey,
      data,
      mediaType: imageType,
    });
    return {
      content,
      status: "parsed" as const,
      metadata: {
        parser: "minimax-m3-image",
        parsedAt: new Date().toISOString(),
        requiresVisionModel: true,
      },
    };
  }

  const apiKey = await getMiniMaxKey(options.userId);
  if (!apiKey) {
    throw new Error("尚未配置 MiniMax API Key，请先在设置中添加");
  }

  await updateStage(options.file, "model", { parser: "minimax-m3-pdf" });
  const content = await parseDocumentWithMiniMax({
    apiKey,
    data,
    filename: options.file.originalName,
    mediaType: "application/pdf",
  });
  return {
    content,
    status: "parsed" as const,
    metadata: {
      parser: "minimax-m3-pdf",
      parsedAt: new Date().toISOString(),
      requiresVisionModel: true,
    },
  };
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
