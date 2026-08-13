import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createDocumentChunks } from "@/lib/rag/vector-store";
import { embedChunksForFile } from "@/lib/rag/embedding";
import { getProviderApiKey } from "@/lib/data/provider-access";
import { invalidateSearchCache } from "@/lib/cache/rag-search-cache";
import { invalidateFileSelectCache } from "@/lib/cache/rag-file-select-cache";
import { FILE_CATEGORIES } from "@/lib/file-categories";
import {
  fallbackIndexMetadata,
  refreshProjectIndex,
} from "@/lib/rag/project-index";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { deleteFileAsset } from "@/lib/files/delete-file-asset";
import { computeContentFingerprint } from "@/lib/files/content-fingerprint";
import { recordFileContentChange } from "@/lib/learning/services";

const updateFileSchema = z
  .object({
    textContent: z.string().min(1).max(500000).optional(),
    category: z.enum(FILE_CATEGORIES).nullable().optional(),
  })
  .refine((value) => value.textContent !== undefined || value.category !== undefined, {
    message: "没有可更新的内容",
  });

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const { id } = await params;

  const file = await prisma.fileAsset.findFirst({
    where: { id, userId: session.user.id },
    select: {
      id: true,
      filename: true,
      originalName: true,
      mimeType: true,
      size: true,
      textContent: true,
      enhancementStatus: true,
      processingMetadata: true,
      status: true,
      category: true,
      categoryConfidence: true,
      createdAt: true,
      updatedAt: true,
      resources: { select: { id: true, relativePath: true } },
    },
  });

  if (!file) {
    return NextResponse.json({ error: "文件不存在" }, { status: 404 });
  }

  return NextResponse.json({
    file: {
      id: file.id,
      filename: file.filename,
      originalName: file.originalName,
      mimeType: file.mimeType,
      size: file.size,
      textContent: file.textContent,
      enhancementStatus: file.enhancementStatus,
      processingMetadata: file.processingMetadata,
      status: file.status,
      category: file.category,
      categoryConfidence: file.categoryConfidence,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
      resources: file.resources.map((resource) => ({
        id: resource.id,
        relativePath: resource.relativePath,
      })),
    },
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const { id } = await params;
  const file = await prisma.fileAsset.findFirst({
    where: { id, userId: session.user.id },
    include: {
      resources: {
        select: { storageProvider: true, storagePath: true },
      },
    },
  });
  if (!file) {
    return NextResponse.json({ error: "文件不存在" }, { status: 404 });
  }
  const parsed = updateFileSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  if (parsed.data.textContent !== undefined && !["parsed", "partial"].includes(file.status)) {
    return NextResponse.json(
      { error: "只有已解析文件可以编辑 OCR 原文" },
      { status: 400 }
    );
  }

  const correctedIndexMetadata =
    parsed.data.textContent !== undefined
      ? fallbackIndexMetadata({
          filename: file.originalName,
          content: parsed.data.textContent,
        })
      : null;

  const currentFingerprint =
    parsed.data.textContent !== undefined
      ? computeContentFingerprint(parsed.data.textContent)
      : null;
  await prisma.fileAsset.update({
    where: { id: file.id },
    data: {
      ...(parsed.data.textContent !== undefined && {
        textContent: parsed.data.textContent,
        enhancementStatus: file.enhancedContent ? "stale" : "none",
        contentFingerprint: currentFingerprint,
        processingMetadata: {
          ...(file.processingMetadata && typeof file.processingMetadata === "object"
            ? file.processingMetadata
            : {}),
          ...correctedIndexMetadata,
          correctedAt: new Date().toISOString(),
        },
      }),
      ...(parsed.data.category !== undefined && {
        category: parsed.data.category,
        categoryConfidence: null,
      }),
    },
  });
  if (
    parsed.data.textContent !== undefined &&
    file.contentFingerprint &&
    currentFingerprint
  ) {
    await recordFileContentChange({
      userId: session.user.id,
      fileAssetId: file.id,
      previousFingerprint: file.contentFingerprint,
      currentFingerprint,
    }).catch((error) => {
      logger.warn("手工修订 OCR 后学习资料新鲜度更新失败", {
        fileId: file.id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
  if (parsed.data.textContent !== undefined) {
    await createDocumentChunks({
      fileAssetId: file.id,
      projectId: file.projectId,
      userId: session.user.id,
      textContent: parsed.data.textContent,
      title: file.originalName,
    });
    // 手工修订 OCR 后同步重建向量:此前新 chunk 全部无 embedding,
    // 向量检索会静默退化。失败只记录,不影响修订本身。
    const bailianKey = await getProviderApiKey(
      session.user.id,
      "bailian"
    ).catch(() => undefined);
    if (bailianKey) {
      const stats = await embedChunksForFile({
        fileAssetId: file.id,
        apiKey: bailianKey,
      }).catch((error) => {
        logger.warn("手工修订后向量重建失败", {
          fileId: file.id,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      });
      if (stats) {
        await prisma.fileAsset
          .update({
            where: { id: file.id },
            data: {
              processingMetadata: {
                ...(file.processingMetadata &&
                typeof file.processingMetadata === "object"
                  ? file.processingMetadata
                  : {}),
                embeddingStatus:
                  stats.total > 0 && stats.embedded === stats.total
                    ? "complete"
                    : "partial",
              },
            },
          })
          .catch(() => {});
      }
    }
  }
  if (file.projectId) {
    await refreshProjectIndex({
      userId: session.user.id,
      projectId: file.projectId,
    }).catch(() => {});
    await invalidateSearchCache(file.projectId);
    await invalidateFileSelectCache(file.projectId);
  }

  return NextResponse.json({
    success: true,
    enhancementStatus: file.enhancedContent ? "stale" : "none",
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const { id } = await params;

  const result = await deleteFileAsset({
    fileAssetId: id,
    userId: session.user.id,
  });

  if (!result.deleted) {
    if (result.error === "NOT_FOUND") {
      return NextResponse.json({ error: "文件不存在" }, { status: 404 });
    }
    logger.error("删除文件失败", { fileId: id, error: result.error });
    return NextResponse.json(
      { error: result.error || "删除文件失败" },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
