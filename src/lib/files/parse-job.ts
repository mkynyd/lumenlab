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
import {
  runFileParseJob,
  enqueueFileParseJobs,
} from "@/lib/document-pipeline/job-runner";
import type { JobContext, ParseStage } from "@/lib/document-pipeline/job-runner";

export async function runParseStages(
  ctx: JobContext,
  onStageUpdate: (stage: ParseStage, data: { attempt: number; warnings: string[] }) => void
): Promise<void> {
  const file = await prisma.fileAsset.findFirst({
    where: { id: ctx.fileAssetId, userId: ctx.userId },
  });
  if (!file) throw new Error("文件不存在");

  const attempt = (stage: ParseStage) => {
    const current = ctx.attempt + 1;
    onStageUpdate(stage, { attempt: current, warnings: [] });
    return current;
  };

  await updateStage(file, "uploading", {
    parseStartedAt: new Date().toISOString(),
    parseRunId: crypto.randomUUID(),
  });

  // Stage: read_file
  attempt("read_file");
  const data = await readStoredObject({
    provider: file.storageProvider as StorageProvider,
    key: file.storagePath,
  });

  // Stage: parse_layout
  attempt("parse_layout");
  const input: ParseInput = {
    userId: ctx.userId,
    fileAssetId: file.id,
    filename: file.originalName,
    mimeType: file.mimeType,
    data,
    apiKeys: {
      minimax: await getMiniMaxKey(ctx.userId),
      mineru: await getMinerUToken(ctx.userId),
      bailian: await getBailianKey(ctx.userId),
    },
  };

  await updateStage(file, "model", { parser: "document-pipeline" });
  const pipeline = new DocumentPipeline();
  const result = await pipeline.run(input, (stage, progress) => {
    const normalizedStage =
      stage === "running" || stage === "converting"
        ? "model"
        : stage === "complete" || stage === "done"
          ? "complete"
          : stage === "failed"
            ? "failed"
            : stage;
    if (normalizedStage in PARSING_STAGES) {
      void updateStage(file, normalizedStage as keyof typeof PARSING_STAGES, {
        ...(progress ? { current: progress.current, total: progress.total } : {}),
      });
    }
  });

  // Stage: store_assets
  attempt("store_assets");
  const storedAssets = result.assets.length > 0
    ? await persistFileAssets(file.id, ctx.userId, result.assets)
    : [];

  // Stage: rewrite_refs
  attempt("rewrite_refs");
  const resourceUrlMap = new Map(storedAssets.map((s) => [s.relativePath, s.resourceUrl]));
  const content = rewriteAssetReferences(result.content, resourceUrlMap);

  // Stage: render metadata already done by pipeline; build index metadata.
  const indexMetadata = await generateFileIndexMetadata({
    userId: ctx.userId,
    filename: file.originalName,
    content,
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
      textContent: content,
      status: result.status,
      enhancementStatus: file.enhancedContent ? "stale" : "none",
      processingMetadata: mergeMetadata(file.processingMetadata, completedMetadata),
    },
  });

  // Stage: chunk_index
  attempt("chunk_index");

  // Build absolute URLs for local resources so the multimodal embedding provider can fetch them.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";
  const absoluteResourceUrlMap = new Map(
    [...resourceUrlMap.entries()].map(([path, url]) => [
      path,
      url.startsWith("/") && appUrl ? `${appUrl.replace(/\/$/, "")}${url}` : url,
    ])
  );

  let chunksCreated = false;
  try {
    await createDocumentChunks({
      fileAssetId: file.id,
      projectId: file.projectId,
      userId: ctx.userId,
      textContent: content,
      title: file.originalName,
      blocks: result.blocks,
      assetResourceUrlMap: absoluteResourceUrlMap,
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
    const bailianKey = await getBailianKey(ctx.userId);
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
      userId: ctx.userId,
      projectId: file.projectId,
    }).catch(() => {});
  }
}

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

function isInternalRelativePath(value: string): boolean {
  if (!value) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return false;
  if (value.startsWith("#")) return false;
  return true;
}

export function rewriteAssetReferences(
  content: string,
  assetMap: Map<string, string>
): string {
  if (assetMap.size === 0) return content;

  function resolveAssetUrl(rawValue: string): string | undefined {
    if (assetMap.has(rawValue)) return assetMap.get(rawValue);
    try {
      const decoded = decodeURIComponent(rawValue);
      if (decoded !== rawValue && assetMap.has(decoded)) {
        return assetMap.get(decoded);
      }
    } catch {
      // decodeURIComponent failed; fall through
    }
    return undefined;
  }

  // Markdown image references: ![alt](relative/path.png)
  let rewritten = content.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    (match, alt, href) => {
      if (!isInternalRelativePath(href)) return match;
      const url = resolveAssetUrl(href);
      if (!url) return match;
      return `![${alt}](${url})`;
    }
  );

  // HTML img src references: <img src="relative/path.png" ...>
  rewritten = rewritten.replace(
    /<img([^>]*)\bsrc=["']([^"']+)["']([^>]*)>/gi,
    (match, before, src, after) => {
      if (!isInternalRelativePath(src)) return match;
      const url = resolveAssetUrl(src);
      if (!url) return match;
      return `<img${before}src="${url}"${after}>`;
    }
  );

  return rewritten;
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
    const normalizedStage =
      stage === "running" || stage === "converting"
        ? "model"
        : stage === "complete" || stage === "done"
          ? "complete"
          : stage === "failed"
            ? "failed"
            : stage;
    if (normalizedStage in PARSING_STAGES) {
      void updateStage(options.file, normalizedStage as keyof typeof PARSING_STAGES, {
        ...(progress ? { current: progress.current, total: progress.total } : {}),
      });
    }
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

  // Ensure a job exists and run it.
  const job = await prisma.fileParseJob.upsert({
    where: { fileAssetId: file.id },
    create: {
      userId: input.userId,
      fileAssetId: file.id,
      status: "pending",
      stage: "pending",
      attempt: 0,
    },
    update: {
      status: "pending",
      stage: "pending",
      attempt: 0,
      error: null,
      completedAt: null,
    },
  });

  await runFileParseJob(job.id);

  // Return latest state
  const updated = await prisma.fileAsset.findFirst({
    where: { id: input.fileId, userId: input.userId },
  });
  return {
    fileId: updated?.id,
    projectId: updated?.projectId,
    status: updated?.status,
    metadata: updated?.processingMetadata,
  };
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
  void enqueueFileParseJobs(input.fileIds, input.userId);
}
