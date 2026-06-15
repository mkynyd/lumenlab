import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createDocumentChunks } from "@/lib/rag/vector-store";
import { parseImageWithMiniMax } from "@/lib/vision/minimax";
import { parsePdf } from "@/lib/files/pdf-parser";
import type { Prisma } from "@/generated/prisma/client";
import { getProviderApiKey } from "@/lib/data/provider-access";
import { ProviderAccessError } from "@/lib/provider-access";

export const runtime = "nodejs";
export const maxDuration = 300;

const UPLOAD_DIR = path.join(process.cwd(), "uploads");
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function mergeMetadata(
  current: unknown,
  next: Record<string, unknown>
): Prisma.InputJsonObject {
  return {
    ...(current && typeof current === "object"
      ? (current as Prisma.InputJsonObject)
      : {}),
    ...(next as Prisma.InputJsonObject),
  } as Prisma.InputJsonObject;
}

async function getMiniMaxKey(userId: string): Promise<string | undefined> {
  try {
    return await getProviderApiKey(userId, "minimax");
  } catch (error) {
    if (
      error instanceof ProviderAccessError &&
      error.code === "credential_unavailable"
    ) {
      return undefined;
    }
    throw error;
  }
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const userId = session.user.id;
  const { id } = await params;

  const file = await prisma.fileAsset.findFirst({
    where: { id, userId },
  });
  if (!file) {
    return NextResponse.json({ error: "文件不存在" }, { status: 404 });
  }

  const isPdf = file.mimeType === "application/pdf";
  const isImage = IMAGE_TYPES.has(file.mimeType);
  if (!isPdf && !isImage) {
    await prisma.fileAsset.update({
      where: { id: file.id },
      data: { status: "unsupported" },
    });
    return NextResponse.json(
      { error: "当前文件类型不支持图片解析" },
      { status: 400 }
    );
  }

  await prisma.fileAsset.update({
    where: { id: file.id },
    data: { status: "parsing" },
  });

  try {
    const resolvedPath = path.resolve(UPLOAD_DIR, file.storagePath);
    if (!resolvedPath.startsWith(`${path.resolve(UPLOAD_DIR)}${path.sep}`)) {
      throw new Error("文件路径无效");
    }
    const data = await readFile(resolvedPath);
    let content: string;
    let status: "parsed" | "partial" = "parsed";
    let metadata: Record<string, unknown>;

    if (isPdf) {
      const result = await parsePdf({
        data,
        filename: file.originalName,
        minimaxApiKey: await getMiniMaxKey(userId),
      });
      content = result.content;
      status = result.status;
      metadata = result.metadata;
    } else {
      const minimaxKey = await getMiniMaxKey(userId);
      if (!minimaxKey) {
        throw new Error("尚未配置 MiniMax API Key，请先在设置中添加");
      }
      content = await parseImageWithMiniMax({
        apiKey: minimaxKey,
        data,
        mediaType: file.mimeType as "image/png" | "image/jpeg" | "image/webp",
      });
      metadata = {
        parser: "minimax-image",
        parsedAt: new Date().toISOString(),
      };
    }

    await prisma.fileAsset.update({
      where: { id: file.id },
      data: {
        textContent: content,
        status,
        enhancementStatus: file.enhancedContent ? "stale" : "none",
        processingMetadata: mergeMetadata(file.processingMetadata, metadata),
      },
    });

    try {
      await createDocumentChunks({
        fileAssetId: file.id,
        projectId: file.projectId,
        userId,
        textContent: content,
        title: file.originalName,
      });
    } catch {
      await prisma.fileAsset.update({
        where: { id: file.id },
        data: {
          processingMetadata: mergeMetadata(file.processingMetadata, {
            ...metadata,
            chunkWarning: "解析内容已保存，但检索分块创建失败",
          }),
        },
      });
    }

    return NextResponse.json({
      file: {
        id: file.id,
        status,
        hasTextContent: true,
        parser: metadata.parser,
        truncated: metadata.truncated || false,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "文件解析失败，请稍后重试";
    await prisma.fileAsset.update({
      where: { id: file.id },
      data: {
        status: "failed",
        processingMetadata: mergeMetadata(file.processingMetadata, {
          parseError: message.slice(0, 300),
          failedAt: new Date().toISOString(),
        }),
      },
    });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
