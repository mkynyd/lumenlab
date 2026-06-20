"use client";

import { useState } from "react";
import Link from "next/link";
import { Download, Folder, NavArrowLeft } from "iconoir-react";
import { MarkdownContent } from "@/components/markdown/markdown-content";
import { ExportReadyMarker } from "@/components/tools/export-ready-marker";
import { SaveToProjectDialog } from "@/components/tools/save-to-project-dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ConversionDetail } from "@/lib/api/types";
import { downloadTextFile } from "@/lib/browser/download-text-file";
import { cn } from "@/lib/utils";

interface ConversionViewerProps {
  conversion: ConversionDetail;
  printMode?: boolean;
}

function formatBytes(bytes: number | null) {
  if (bytes === null) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ConversionViewer({
  conversion,
  printMode = false,
}: ConversionViewerProps) {
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [feedback, setFeedback] = useState<{
    message: string;
    tone: "error" | "success";
  } | null>(null);

  function downloadContent() {
    downloadTextFile(
      conversion.markdownContent,
      conversion.originalName.replace(/\.pdf$/i, ".md")
    );
    setFeedback({ message: "Markdown 文件已开始下载", tone: "success" });
  }

  const details = [
    conversion.pageCount ? `${conversion.pageCount} 页` : null,
    formatBytes(conversion.fileSize),
    new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(conversion.createdAt)),
  ].filter(Boolean);
  const assetsByPath = new Map(
    conversion.assets.map((asset) => [asset.relativePath, asset.id])
  );
  const hasLegacyMissingAssets =
    conversion.assets.length === 0 &&
    /!\[[^\]]*]\([^)]*\)|<img\b[^>]*>/i.test(conversion.markdownContent);

  function resolveImageUrl(src: string) {
    const normalized = src.replace(/^\.\//, "");
    const assetId = assetsByPath.get(normalized);
    return assetId
      ? `/api/tools/conversions/${conversion.id}/assets/${assetId}`
      : src;
  }

  if (printMode) {
    return (
      <main
        data-conversion-print
        className="mx-auto w-full max-w-4xl bg-white px-2 py-1 text-black"
      >
        <MarkdownContent
          content={conversion.markdownContent}
          resolveImageUrl={resolveImageUrl}
          imageLoading="eager"
        />
        <ExportReadyMarker />
      </main>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 bg-[var(--color-surface)] px-4 py-3 sm:px-6">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 lg:flex-row lg:items-center">
          <div className="flex min-w-0 items-center gap-2">
            <Button
              asChild
              variant="ghost"
              size="icon"
              className="size-11 sm:size-8"
              aria-label="返回文档转换"
            >
              <Link href="/tools">
                <NavArrowLeft />
              </Link>
            </Button>
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold">{conversion.title}</h1>
              <p className="mt-0.5 truncate text-xs text-[var(--color-text-tertiary)]">
                {conversion.originalName}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 lg:ml-auto">
            <Button
              asChild
              variant="secondary"
              size="sm"
              className="min-h-11 sm:min-h-0"
            >
              <a href={`/api/tools/conversions/${conversion.id}/download`}>
                <Download data-icon="inline-start" strokeWidth={1.8} />
                下载完整包
              </a>
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="min-h-11 sm:min-h-0"
              onClick={downloadContent}
            >
              <Download data-icon="inline-start" strokeWidth={1.8} />
              下载 .md
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="min-h-11 sm:min-h-0"
              onClick={() => setShowProjectPicker(true)}
            >
              <Folder data-icon="inline-start" strokeWidth={1.8} />
              保存到项目
            </Button>
          </div>
        </div>

        <div className="mx-auto mt-3 flex w-full max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-text-tertiary)]">
          {details.map((detail, index) => (
            <span key={String(detail)} className="flex items-center gap-3">
              {index > 0 && <span aria-hidden="true">·</span>}
              {detail}
            </span>
          ))}
          {feedback && (
            <span
              role={feedback.tone === "error" ? "alert" : "status"}
              className={cn(
                "ml-auto",
                feedback.tone === "error"
                  ? "text-[var(--color-error)]"
                  : "text-[var(--color-success)]"
              )}
            >
              {feedback.message}
            </span>
          )}
        </div>
      </header>

      {hasLegacyMissingAssets && (
        <p className="mx-auto mt-3 w-[calc(100%-2rem)] max-w-6xl rounded-[var(--radius-lg)] bg-[var(--color-panel-muted)] px-4 py-3 text-xs text-[var(--color-text-secondary)]">
          该记录创建于图片归档功能上线前，原图片无法恢复。
        </p>
      )}

      <ScrollArea className="min-h-0 flex-1 [&_[data-radix-scroll-area-viewport]>div]:!block [&_[data-radix-scroll-area-viewport]>div]:!min-w-0">
        <article className="mx-auto w-full min-w-0 max-w-4xl px-4 py-8 sm:px-8 sm:py-10">
          <MarkdownContent
            content={conversion.markdownContent}
            resolveImageUrl={resolveImageUrl}
          />
        </article>
      </ScrollArea>

      <SaveToProjectDialog
        conversionId={conversion.id}
        open={showProjectPicker}
        onOpenChange={setShowProjectPicker}
        onSaved={(projectName) =>
          setFeedback({
            message: `已保存到「${projectName}」`,
            tone: "success",
          })
        }
      />
    </div>
  );
}
