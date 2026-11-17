import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { safeExportFilename } from "@/lib/export/filename";
import { markdownToDocx } from "@/lib/export/markdown-to-docx";
import { renderArtifactPdf } from "@/lib/export/browser-pdf";
import { renderArtifactFile } from "@/lib/export/artifact-file";
import { artifactDownloadFormats, isArtifactDownloadFormat } from "@/lib/artifacts/download";
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

    const requestedFormat = new URL(request.url).searchParams.get("format") || "markdown";
    if (!isArtifactDownloadFormat(requestedFormat)) {
      return NextResponse.json({ error: "不支持的导出格式" }, { status: 400 });
    }
    format = requestedFormat;

    const { extension, mimeType: contentType } = artifactDownloadFormats[format];
    const filename = safeExportFilename(artifact.title, extension);
    const disposition = `attachment; filename="artifact.${extension}"; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)}`;

    const cacheKey = buildExportCacheKey(artifact.id, format, artifact.content);
    const cached = await getCachedExport(cacheKey);
    if (cached) {
      void recordExportCacheResult(format, "hit");
      return new Response(new Uint8Array(cached), {
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": disposition,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
          "X-Cache": "HIT",
        },
      });
    }

    const delivered = artifact.metadata && typeof artifact.metadata === "object" &&
      !Array.isArray(artifact.metadata) && isArtifactDownloadFormat(artifact.metadata.delivery);
    const body = delivered || format === "xlsx" || format === "pptx"
      ? await renderArtifactFile(artifact.content, artifact.title, format, request.signal)
      : Buffer.from(
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
    if (format === "pdf" && !delivered) await validatePdfExport(body);
    await setCachedExport(cacheKey, body);
    void recordExportCacheResult(format, "miss");

    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": disposition,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
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
