import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { safeExportFilename } from "@/lib/export/filename";
import { markdownToDocx } from "@/lib/export/markdown-to-docx";
import { renderArtifactPdf } from "@/lib/export/browser-pdf";
import { validatePdfExport } from "@/lib/export/pdf-validation";
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
  let artifactId: string | undefined;
  let format: ExportFormat | undefined;
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
    }
    const { id } = await params;
    artifactId = id;
    const artifact = await prisma.artifact.findFirst({
      where: { id, userId: session.user.id },
    });
    if (!artifact) {
      return NextResponse.json({ error: "成果不存在" }, { status: 404 });
    }

    const requestedFormat = (new URL(request.url).searchParams.get("format") ||
      "markdown") as ExportFormat;
    if (!["markdown", "docx", "pdf"].includes(requestedFormat)) {
      return NextResponse.json({ error: "不支持的导出格式" }, { status: 400 });
    }
    format = requestedFormat;

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
        ? artifact.content ?? ""
        : format === "docx"
          ? await markdownToDocx(artifact.content)
          : await renderArtifactPdf({
              requestUrl: request.url,
              artifactId: artifact.id,
              cookieHeader: request.headers.get("cookie") || "",
            })
    );
    if (format === "pdf") await validatePdfExport(body);
    await setCachedExport(cacheKey, body);
    void recordExportCacheResult(format, "miss");

    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": disposition,
        "X-Cache": "MISS",
      },
    });
  } catch (error) {
    logger.error("导出失败", {
      format,
      artifactId,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "导出失败,请稍后重试" }, { status: 500 });
  }
}
