import crypto from "crypto";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { renderMarkdownPdf } from "@/lib/export/browser-pdf";
import {
  buildConversionPackage,
  sanitizeExportBaseName,
} from "@/lib/export/conversion-package";
import {
  deleteStoredObject,
  readStoredObject,
  uploadObjectBuffer,
  type StorageProvider,
} from "@/lib/storage/object-storage";

function packageResponse(buffer: Buffer, filename: string) {
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const { id } = await params;
  const conversion = await prisma.documentConversion.findFirst({
    where: { id, userId: session.user.id },
    include: { assets: true },
  });
  if (!conversion) {
    return NextResponse.json({ error: "转换记录不存在" }, { status: 404 });
  }

  const baseName = sanitizeExportBaseName(
    conversion.originalName.replace(/\.pdf$/i, "")
  );
  const filename = `${baseName}.zip`;
  if (conversion.exportStorageProvider && conversion.exportStoragePath) {
    const cached = await readStoredObject({
      provider: conversion.exportStorageProvider as StorageProvider,
      key: conversion.exportStoragePath,
    });
    return packageResponse(cached, filename);
  }

  const assets = await Promise.all(
    conversion.assets.map(async (asset) => ({
      relativePath: asset.relativePath,
      mimeType: asset.mimeType,
      buffer: await readStoredObject({
        provider: asset.storageProvider as StorageProvider,
        key: asset.storagePath,
      }),
    }))
  );
  const pdfBuffer = await renderMarkdownPdf({
    requestUrl: request.url,
    conversionId: conversion.id,
    cookieHeader: request.headers.get("cookie") || "",
  });
  const packageBuffer = await buildConversionPackage({
    baseName,
    markdownContent: conversion.markdownContent,
    pdfBuffer,
    assets,
  });
  const exportId = crypto.randomUUID();
  const candidate = await uploadObjectBuffer({
    key: [
      "users",
      session.user.id,
      "conversions",
      conversion.id,
      "exports",
      `${exportId}.zip`,
    ].join("/"),
    mimeType: "application/zip",
    buffer: packageBuffer,
  });

  try {
    const updated = await prisma.documentConversion.updateMany({
      where: {
        id: conversion.id,
        userId: session.user.id,
        exportStoragePath: null,
      },
      data: {
        exportStorageProvider: candidate.provider,
        exportStoragePath: candidate.key,
        exportSize: packageBuffer.length,
        exportGeneratedAt: new Date(),
      },
    });
    if (updated.count === 0) {
      await deleteStoredObject(candidate).catch(() => {});
      const winner = await prisma.documentConversion.findFirst({
        where: { id: conversion.id, userId: session.user.id },
        select: { exportStorageProvider: true, exportStoragePath: true },
      });
      if (!winner?.exportStorageProvider || !winner.exportStoragePath) {
        throw new Error("完整包缓存并发写入失败，请重试");
      }
      const cached = await readStoredObject({
        provider: winner.exportStorageProvider as StorageProvider,
        key: winner.exportStoragePath,
      });
      return packageResponse(cached, filename);
    }
  } catch (error) {
    await deleteStoredObject(candidate).catch(() => {});
    throw error;
  }

  return packageResponse(packageBuffer, filename);
}
