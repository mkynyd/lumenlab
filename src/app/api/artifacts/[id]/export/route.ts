import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { safeExportFilename } from "@/lib/export/filename";
import { markdownToDocx } from "@/lib/export/markdown-to-docx";
import { markdownToPdf } from "@/lib/export/markdown-to-pdf";
import {
  buildExportCacheKey,
  getCachedExport,
  recordExportCacheResult,
  setCachedExport,
  type ExportFormat,
} from "@/lib/cache/export-cache";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const { id } = await params;
  const artifact = await prisma.artifact.findFirst({
    where: { id, userId: session.user.id },
  });
  if (!artifact) {
    return NextResponse.json({ error: "成果不存在" }, { status: 404 });
  }

  const format = (new URL(request.url).searchParams.get("format") ||
    "markdown") as ExportFormat;
  if (!["markdown", "docx", "pdf"].includes(format)) {
    return NextResponse.json({ error: "不支持的导出格式" }, { status: 400 });
  }

  const extension = format === "markdown" ? "md" : format;
  const filename = safeExportFilename(artifact.title, extension);
  const disposition = `attachment; filename="artifact.${extension}"; filename*=UTF-8''${encodeURIComponent(filename)}`;

  const cacheKey = buildExportCacheKey(artifact.id, format, artifact.content);
  const cached = await getCachedExport(cacheKey);
  const contentType =
    format === "markdown"
      ? "text/markdown; charset=utf-8"
      : format === "docx"
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : "application/pdf";

  if (cached) {
    void recordExportCacheResult(format, "hit");
    return new Response(new Uint8Array(cached), {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": disposition,
        "X-Cache": "HIT",
      },
    });
  }

  const body = Buffer.from(
    format === "markdown"
      ? artifact.content
      : format === "docx"
        ? await markdownToDocx(artifact.content)
        : await markdownToPdf(artifact.content)
  );
  await setCachedExport(cacheKey, body);
  void recordExportCacheResult(format, "miss");

  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": disposition,
      "X-Cache": "MISS",
    },
  });
}
