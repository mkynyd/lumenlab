import crypto from "crypto";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getProviderApiKey } from "@/lib/data/provider-access";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { parseFileWithMinerU, MinerUError } from "@/lib/parse/mineru";
import { getMinerUErrorMessage } from "@/lib/parse/mineru-errors";
import {
  deleteStoredObjects,
  storeConversionAssets,
  type StoredConversionAsset,
} from "@/lib/conversions/assets";

const MAX_PDF_SIZE = 200 * 1024 * 1024;
const NEED_TOKEN_MESSAGE = getMinerUErrorMessage("need-token");

function isUploadFile(value: unknown): value is File {
  return Boolean(
    value &&
      typeof value === "object" &&
      "name" in value &&
      typeof (value as { name?: unknown }).name === "string" &&
      "size" in value &&
      typeof (value as { size?: unknown }).size === "number" &&
      "arrayBuffer" in value &&
      typeof (value as { arrayBuffer?: unknown }).arrayBuffer === "function"
  );
}

function isPdf(file: File) {
  return (
    file.name.toLowerCase().endsWith(".pdf") &&
    (!file.type || file.type === "application/pdf")
  );
}

function conversionTitle(filename: string) {
  return filename.replace(/\.pdf$/i, "").trim() || "PDF 文档";
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "无效的上传请求" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!isUploadFile(file) || !isPdf(file)) {
    return NextResponse.json(
      { error: getMinerUErrorMessage("invalid-file"), code: "invalid-file" },
      { status: 400 }
    );
  }
  if (file.size > MAX_PDF_SIZE) {
    return NextResponse.json(
      {
        error: getMinerUErrorMessage("file-too-large"),
        code: "file-too-large",
      },
      { status: 413 }
    );
  }

  const oneTimeToken = String(formData.get("mineruToken") || "").trim();
  let token: string;
  try {
    token = await getProviderApiKey(session.user.id, "mineru");
  } catch {
    if (!oneTimeToken) {
      return NextResponse.json(
        { error: NEED_TOKEN_MESSAGE, needToken: true, code: "need-token" },
        { status: 403 }
      );
    }
    token = oneTimeToken;
  }

  const userId = session.user.id;
  const fileBuffer = Buffer.from(await file.arrayBuffer());
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (payload: Record<string, unknown>) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)
        );
      };

      void (async () => {
        let pageCount: number | null = null;
        let storedAssets: StoredConversionAsset[] = [];
        try {
          const parsed = await parseFileWithMinerU({
            token,
            fileBuffer,
            filename: file.name,
            onProgress(stage, progress) {
              const normalizedStage =
                stage === "running" || stage === "converting"
                  ? "model"
                  : stage;
              if (normalizedStage === "model" && progress) {
                pageCount = progress.total > 0 ? progress.total : pageCount;
                send({
                  stage: "model",
                  extractedPages: progress.current,
                  totalPages: progress.total,
                });
              } else if (
                normalizedStage === "uploading" ||
                normalizedStage === "pending"
              ) {
                send({ stage: normalizedStage });
              }
            },
          });

          const conversionId = crypto.randomUUID();
          storedAssets = await storeConversionAssets({
            userId,
            conversionId,
            assets: parsed.assets,
          });

          const conversion = await prisma.documentConversion.create({
            data: {
              id: conversionId,
              userId,
              title: conversionTitle(file.name),
              originalName: file.name,
              markdownContent: parsed.content,
              status: "completed",
              fileSize: file.size,
              pageCount,
              metadata: parsed.metadata,
              assets: {
                create: storedAssets.map((asset) => ({
                  id: asset.id,
                  relativePath: asset.relativePath,
                  mimeType: asset.mimeType,
                  size: asset.size,
                  storageProvider: asset.storageProvider,
                  storagePath: asset.storagePath,
                })),
              },
            },
            select: {
              id: true,
              assets: { select: { id: true, relativePath: true } },
            },
          });

          send({
            stage: "done",
            conversionId: conversion.id,
            content: parsed.content,
            fileName: file.name.replace(/\.pdf$/i, ".md"),
            metadata: { ...parsed.metadata, pageCount },
            assetCount: conversion.assets.length,
            assets: conversion.assets,
          });
        } catch (error) {
          if (storedAssets.length > 0) {
            await deleteStoredObjects(
              storedAssets.map((asset) => ({
                provider: asset.storageProvider,
                key: asset.storagePath,
              }))
            ).catch((cleanupError) => {
              logger.warn("PDF 转换图片补偿清理失败", {
                userId,
                filename: file.name,
                error: String(cleanupError),
              });
            });
          }
          const message =
            error instanceof Error ? error.message : "转换失败，请稍后重试";
          const code =
            error instanceof MinerUError ? String(error.code) : undefined;
          logger.error("PDF 转 Markdown 失败", {
            userId,
            filename: file.name,
            error: String(error),
          });
          send({ stage: "failed", error: message, ...(code ? { code } : {}) });
        } finally {
          controller.close();
        }
      })();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
