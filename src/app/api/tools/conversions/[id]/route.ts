import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { deleteStoredObjects } from "@/lib/conversions/assets";
import { logger } from "@/lib/logger";
import type { StorageProvider } from "@/lib/storage/object-storage";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const { id } = await params;
  const conversion = await prisma.documentConversion.findFirst({
    where: { id, userId: session.user.id },
    include: {
      assets: { select: { id: true, relativePath: true } },
    },
  });
  if (!conversion) {
    return NextResponse.json({ error: "转换记录不存在" }, { status: 404 });
  }

  return NextResponse.json({
    conversion: {
      id: conversion.id,
      title: conversion.title,
      originalName: conversion.originalName,
      status: conversion.status,
      markdownContent: conversion.markdownContent,
      fileSize: conversion.fileSize,
      pageCount: conversion.pageCount,
      metadata: conversion.metadata,
      createdAt: conversion.createdAt,
      updatedAt: conversion.updatedAt,
      assets: conversion.assets.map((asset) => ({
        id: asset.id,
        relativePath: asset.relativePath,
      })),
    },
  });
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const { id } = await params;
  const conversion = await prisma.documentConversion.findFirst({
    where: { id, userId: session.user.id },
    select: {
      id: true,
      exportStorageProvider: true,
      exportStoragePath: true,
      assets: {
        select: { storageProvider: true, storagePath: true },
      },
    },
  });
  if (!conversion) {
    return NextResponse.json({ error: "转换记录不存在" }, { status: 404 });
  }

  const objects = conversion.assets.map((asset) => ({
    provider: asset.storageProvider as StorageProvider,
    key: asset.storagePath,
  }));
  if (conversion.exportStorageProvider && conversion.exportStoragePath) {
    objects.push({
      provider: conversion.exportStorageProvider as StorageProvider,
      key: conversion.exportStoragePath,
    });
  }

  try {
    await deleteStoredObjects(objects);
  } catch (error) {
    logger.error("转换资源删除失败", {
      conversionId: id,
      userId: session.user.id,
      error: String(error),
    });
    return NextResponse.json(
      { error: "转换资源删除失败，请稍后重试" },
      { status: 500 }
    );
  }

  await prisma.documentConversion.delete({ where: { id: conversion.id } });

  return NextResponse.json({ success: true });
}
