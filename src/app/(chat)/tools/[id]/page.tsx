import Link from "next/link";
import { redirect } from "next/navigation";
import { PageEdit } from "iconoir-react";
import { ConversionViewer } from "@/components/tools/conversion-viewer";
import { Button } from "@/components/ui/button";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export default async function ConversionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ print?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/home");

  const { id } = await params;
  const printMode = (await searchParams).print === "1";
  const conversion = await prisma.documentConversion.findFirst({
    where: { id, userId: session.user.id },
    include: {
      assets: { select: { id: true, relativePath: true } },
    },
  });

  if (!conversion) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="max-w-sm text-center">
          <PageEdit
            width={28}
            height={28}
            strokeWidth={1.5}
            className="mx-auto text-[var(--color-text-tertiary)]"
          />
          <h1 className="mt-3 text-base font-semibold">转换记录不存在</h1>
          <p className="mt-1.5 text-sm leading-6 text-[var(--color-text-tertiary)]">
            记录可能已被删除，或不属于当前账户。
          </p>
          <Button asChild size="sm" className="mt-4">
            <Link href="/tools">返回文档工具</Link>
          </Button>
        </div>
      </div>
    );
  }

  const metadata =
    conversion.metadata &&
    typeof conversion.metadata === "object" &&
    !Array.isArray(conversion.metadata)
      ? (conversion.metadata as Record<string, unknown>)
      : null;

  return (
    <ConversionViewer
      printMode={printMode}
      conversion={{
        id: conversion.id,
        title: conversion.title,
        originalName: conversion.originalName,
        status: conversion.status,
        markdownContent: conversion.markdownContent,
        assets: conversion.assets,
        fileSize: conversion.fileSize,
        pageCount: conversion.pageCount,
        metadata,
        createdAt: conversion.createdAt.toISOString(),
        updatedAt: conversion.updatedAt.toISOString(),
      }}
    />
  );
}
