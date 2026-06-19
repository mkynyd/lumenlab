import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  createDocumentChunks,
  deleteChunksByFileAsset,
} from "@/lib/rag/vector-store";
import { FILE_CATEGORIES } from "@/lib/file-categories";
import { refreshProjectIndex } from "@/lib/rag/project-index";
import { z } from "zod";
import { deleteStoredObject, type StorageProvider } from "@/lib/storage/object-storage";

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
  });

  if (!file) {
    return NextResponse.json({ error: "文件不存在" }, { status: 404 });
  }

  return NextResponse.json({ file });
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

  await prisma.fileAsset.update({
    where: { id: file.id },
    data: {
      ...(parsed.data.textContent !== undefined && {
        textContent: parsed.data.textContent,
        enhancementStatus: file.enhancedContent ? "stale" : "none",
        processingMetadata: {
          ...(file.processingMetadata && typeof file.processingMetadata === "object"
            ? file.processingMetadata
            : {}),
          correctedAt: new Date().toISOString(),
        },
      }),
      ...(parsed.data.category !== undefined && {
        category: parsed.data.category,
        categoryConfidence: null,
      }),
    },
  });
  if (parsed.data.textContent !== undefined) {
    await createDocumentChunks({
      fileAssetId: file.id,
      projectId: file.projectId,
      userId: session.user.id,
      textContent: parsed.data.textContent,
      title: file.originalName,
    });
  }
  if (file.projectId) {
    await refreshProjectIndex({
      userId: session.user.id,
      projectId: file.projectId,
    }).catch(() => {});
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

  const file = await prisma.fileAsset.findFirst({
    where: { id, userId: session.user.id },
  });

  if (!file) {
    return NextResponse.json({ error: "文件不存在" }, { status: 404 });
  }

  // Delete related chunks
  await deleteChunksByFileAsset(file.id, session.user.id);

  await deleteStoredObject({
    provider: file.storageProvider as StorageProvider,
    key: file.storagePath,
  }).catch((error) => {
    console.warn("File object deletion failed:", file.id, error);
  });

  await prisma.fileAsset.delete({ where: { id } });
  if (file.projectId) {
    await refreshProjectIndex({
      userId: session.user.id,
      projectId: file.projectId,
    }).catch(() => {});
  }

  return NextResponse.json({ success: true });
}
