import crypto from "crypto";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getProviderApiKey } from "@/lib/data/provider-access";
import { createDocumentChunks } from "@/lib/rag/vector-store";
import {
  generateFileIndexMetadata,
  refreshProjectIndex,
} from "@/lib/rag/project-index";
import { categorizeFiles } from "@/lib/files/categorize";
import { parseFileWithMinerU } from "@/lib/parse/mineru";
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

const OFFICE_EXTENSIONS = new Set([
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
]);

const UNSUPPORTED_OFFICE_EXTENSIONS = new Set([
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

async function getMineruToken(userId: string) {
  try {
    return await getProviderApiKey(userId, "mineru");
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
    throw new Error("暂不支持此格式，请先转换为 docx/pptx/xlsx 后再上传");
  }

  const canUseMinerU =
    ext === "pdf" ||
    options.file.mimeType === "application/pdf" ||
    OFFICE_EXTENSIONS.has(ext) ||
    IMAGE_MEDIA_TYPES.has(options.file.mimeType);
  if (!canUseMinerU) {
    throw new Error(`不支持的文件类型: .${ext || options.file.mimeType}`);
  }

  const mineruToken = await getMineruToken(options.userId);
  if (!mineruToken) {
    throw new Error("尚未配置 MinerU Token，请先在设置中添加");
  }

  const parsed = await parseFileWithMinerU({
    token: mineruToken,
    fileBuffer: data,
    filename: options.file.originalName,
    onProgress: (stage, progress) => {
      const knownStage = stage in PARSING_STAGES
        ? stage as keyof typeof PARSING_STAGES
        : "model";
      void updateStage(options.file, knownStage, {
        parser: "mineru-pipeline",
        ...(progress
          ? {
              progress: {
                extractedPages: progress.current,
                totalPages: progress.total,
              },
            }
          : {}),
      });
    },
  });

  return {
    content: parsed.content,
    status: "parsed" as const,
    metadata: parsed.metadata,
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
          console.error(
            "Embedding failed for file:",
            file.id,
            error instanceof Error ? error.message : error
          );
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
  const parsedByProject = new Map<string, string[]>();
  for (const fileId of [...new Set(input.fileIds)]) {
    try {
      const result = await parseFileAsset({ userId: input.userId, fileId });
      if (result.projectId && ["parsed", "partial"].includes(result.status)) {
        parsedByProject.set(result.projectId, [
          ...(parsedByProject.get(result.projectId) || []),
          result.fileId,
        ]);
      }
    } catch (error) {
      console.error(
        "File parse job failed:",
        error instanceof Error ? error.message : error
      );
    }
  }

  for (const [projectId, fileIds] of parsedByProject) {
    await categorizeFiles({
      userId: input.userId,
      projectId,
      fileIds,
    }).catch((error) => {
      console.error(
        "File categorization failed:",
        error instanceof Error ? error.message : error
      );
    });
  }
}

export function startFileParseBatch(input: {
  userId: string;
  fileIds: string[];
}) {
  void parseFileBatch(input);
}
