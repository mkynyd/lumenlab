"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";
import { Download, Refresh, Trash, Xmark } from "iconoir-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { MarkdownContent } from "@/components/markdown/markdown-content";
import { PdfCanvasViewer } from "@/components/files/pdf-canvas-viewer";
import { OfficeCanvasViewer } from "@/components/files/office-canvas-viewer";
import {
  needsLegacyUnescape,
  unescapeLegacyParsedMarkdown,
} from "@/lib/document-pipeline/legacy-content";
import { cn } from "@/lib/utils";

/**
 * 统一文件详情。资料页与项目侧栏打开的是同一个实现，避免出现两套预览逻辑。
 *
 * 一级标签只有「解析内容」和「原始文件」；「基础解析 / AI 整理」只在确实存在
 * AI 整理内容时出现在解析内容内部 —— 不把 AI 整理结果伪装成原始解析。
 */

export interface FileDetailTarget {
  id: string;
  /** 页面外壳只有 id，展示用的字段等详情接口回来再补。 */
  originalName?: string;
  mimeType?: string;
  size?: number;
  status?: string;
  projectId?: string | null;
  projectName?: string | null;
  category?: string | null;
}

interface ParsedQualityReport {
  warningCount?: number;
  tableCount?: number;
  formulaCount?: number;
  imageRetainedCount?: number;
  checks?: Array<{ rule: string; passed: boolean; message?: string }>;
}

interface FileDetail {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  status: string;
  category: string | null;
  enhancementStatus?: string;
  hasEnhancedContent?: boolean;
  textContent: string | null;
  processingMetadata?: Record<string, unknown> | null;
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
  resources: Array<{ id: string; relativePath: string }>;
}

type DetailTab = "parsed" | "original";
type ParsedVariant = "base" | "enhanced";

const IMAGE_PATTERN = /^image\//;
const PDF_PATTERN = /^application\/pdf$/;
const TEXTUAL_PATTERN = /^(text\/|application\/(json|xml|javascript))/;
/** Office / WPS / iWork：没有可靠的在线渲染，明确说明并给下载入口。 */
const OFFICE_PATTERN =
  /(officedocument|msword|ms-excel|ms-powerpoint|wps-office|vnd\.apple\.)/;
/** 浏览器端渲染库只吃 OOXML；.ppt/.doc/.xls 与 WPS 自有格式仍走下载。 */
const OFFICE_OOXML_PATTERN =
  /(presentationml\.presentation|wordprocessingml\.document|spreadsheetml\.sheet)/;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const STATUS_LABELS: Record<string, string> = {
  uploaded: "排队中",
  parsing: "解析中",
  parsed: "已解析",
  failed: "解析失败",
};

export function FileDetailDialog({
  file,
  onClose,
  onChanged,
  defaultTab = "original",
  shell = "dialog",
}: {
  file: FileDetailTarget;
  onClose: () => void;
  onChanged?: () => void;
  defaultTab?: DetailTab;
  /** `dialog` 自带遮罩与面板；`embedded` 只出内容，由页面外壳负责导航。 */
  shell?: "dialog" | "embedded";
}) {
  const isEmbedded = shell === "embedded";
  const [tab, setTab] = useState<DetailTab>(defaultTab);
  const [variant, setVariant] = useState<ParsedVariant>("base");
  const [enhancedContent, setEnhancedContent] = useState<string | null>(null);
  const [enhancedError, setEnhancedError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const detailQuery = useQuery({
    queryKey: queryKeys.files.detail(file.id),
    queryFn: () => fetchJson<{ file: FileDetail }>(`/api/files/${file.id}`),
  });
  const detail = detailQuery.data?.file ?? null;

  const hasEnhanced = Boolean(detail?.hasEnhancedContent);

  const pipelineVersion =
    (detail?.processingMetadata?.pipelineVersion as string | undefined) ?? null;

  // 0.3.0 之前写库的内容带着转义，直接渲染就是一堆裸星号；这里做等价还原，
  // 不动数据库。手工修订保存后版本号会被写新，不会重复还原。
  const parsedContent = useMemo(() => {
    if (!detail?.textContent) return null;
    return needsLegacyUnescape({
      originalName: detail.originalName,
      mimeType: detail.mimeType,
      pipelineVersion,
      hasTextContent: true,
    })
      ? unescapeLegacyParsedMarkdown(detail.textContent)
      : detail.textContent;
  }, [detail, pipelineVersion]);

  const originalPreviewable = useMemo(() => {
    const mime = detail?.mimeType ?? file.mimeType ?? "";
    return (
      PDF_PATTERN.test(mime) ||
      IMAGE_PATTERN.test(mime) ||
      TEXTUAL_PATTERN.test(mime) ||
      // .pptx/.docx/.xlsx 由浏览器端渲染库接管，也算「可预览」
      OFFICE_OOXML_PATTERN.test(mime)
    );
  }, [detail, file.mimeType]);

  // 默认停在原始文件；类型确实没法在线预览时退回解析内容，而不是给一屏空白。
  // 用 state 记录已经自动切换过的文件，避免渲染期碰 ref，也避免用户手动切回
  // 「原始文件」后又被弹走。
  const [autoSwitchedFor, setAutoSwitchedFor] = useState<string | null>(null);
  if (
    detail &&
    autoSwitchedFor !== detail.id &&
    !originalPreviewable &&
    tab === "original"
  ) {
    setAutoSwitchedFor(detail.id);
    setTab("parsed");
  }

  // AI 整理内容按需拉取，不跟着详情接口一起传，避免每次预览都背着全文。
  useEffect(() => {
    if (variant !== "enhanced" || enhancedContent || !hasEnhanced) return;
    let cancelled = false;
    fetch(`/api/files/${file.id}?include=enhanced`)
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled) setEnhancedContent(data.file?.enhancedContent ?? "");
      })
      .catch(() => {
        if (!cancelled) setEnhancedError("无法加载 AI 整理内容");
      });
    return () => {
      cancelled = true;
    };
  }, [variant, enhancedContent, hasEnhanced, file.id]);

  const quality = useMemo<ParsedQualityReport | null>(() => {
    const report = detail?.processingMetadata?.parseReport;
    return report && typeof report === "object"
      ? (report as ParsedQualityReport)
      : null;
  }, [detail]);

  const embeddingStatus =
    (detail?.processingMetadata?.embeddingStatus as string | undefined) ?? null;

  function resolveImageUrl(src: string) {
    const normalized = src.replace(/^\.\//, "");
    const resource = detail?.resources?.find(
      (item) => item.relativePath === normalized
    );
    return resource ? `/api/files/${file.id}/resources/${resource.id}` : src;
  }

  async function save() {
    const response = await fetch(`/api/files/${file.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ textContent: draft }),
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(typeof data.error === "string" ? data.error : "保存失败");
      return;
    }
    await detailQuery.refetch();
    setEditing(false);
    setMessage("手工修订已保存，检索分块已更新");
    onChanged?.();
  }

  async function reparse() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/files/${file.id}/parse`, { method: "POST" });
      if (!response.ok) throw new Error("reparse failed");
      setMessage("已重新排队解析");
      onChanged?.();
    } catch {
      setMessage("重新解析失败");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const response = await fetch(`/api/files/${file.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("delete failed");
      setDeleteOpen(false);
      onChanged?.();
      onClose();
    } catch {
      setMessage("删除失败");
      setDeleteOpen(false);
    } finally {
      setBusy(false);
    }
  }

  const meta = [
    file.projectName ?? null,
    detail?.category ?? file.category ?? null,
    formatSize(detail?.size ?? file.size ?? 0),
    STATUS_LABELS[detail?.status ?? file.status ?? ""] ?? null,
  ].filter(Boolean);

  const originalUrl = `/api/files/${file.id}/content`;

  return (
    <div
      className={
        isEmbedded
          ? "flex min-h-0 flex-1 flex-col"
          : "fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-overlay)] p-4"
      }
    >
      <div
        className={
          isEmbedded
            ? "flex min-h-0 flex-1 flex-col overflow-hidden"
            : "flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border-light)] bg-[var(--color-surface)] shadow-none"
        }
      >
        {!isEmbedded && (
          <div className="flex items-start justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold">
                {detail?.originalName ?? file.originalName}
              </h2>
              <p className="mt-0.5 truncate text-xs text-[var(--color-text-tertiary)]">
                {meta.join(" · ")}
              </p>
            </div>
            <button
              onClick={onClose}
              className="flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-secondary)] hover:bg-[var(--color-project-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:bg-[var(--color-project-surface-hover)] sm:size-8"
              aria-label="关闭"
            >
              <Xmark width={16} height={16} strokeWidth={1.8} />
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 px-4 pb-2">
          <div
            role="tablist"
            aria-label="文件视图"
            className="flex items-center gap-0.5 rounded-full bg-[var(--color-project-control)] p-0.5"
          >
            {(
              [
                ["parsed", "解析内容"],
                ["original", "原始文件"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs transition-colors",
                  tab === value
                    ? "bg-[var(--color-panel)] font-medium text-[var(--color-text-primary)]"
                    : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "parsed" && hasEnhanced && (
            <div
              role="tablist"
              aria-label="解析来源"
              className="flex items-center gap-0.5 rounded-full bg-[var(--color-project-control)] p-0.5"
            >
              {(
                [
                  ["base", "基础解析"],
                  ["enhanced", "AI 整理"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  role="tab"
                  aria-selected={variant === value}
                  onClick={() => setVariant(value)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs transition-colors",
                    variant === value
                      ? "bg-[var(--color-panel)] font-medium text-[var(--color-text-primary)]"
                      : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          <span className="flex-1" />

          {tab === "parsed" && parsedContent && variant === "base" && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 rounded-full text-xs text-[var(--color-text-secondary)]"
              onClick={() => {
                // 每次进入编辑都从当前正文起步，避免沿用上一轮留下的草稿。
                if (!editing) setDraft(parsedContent ?? "");
                setEditing((value) => !value);
              }}
            >
              {editing ? "取消编辑" : "手工修订解析内容"}
            </Button>
          )}
          <Button variant="ghost" size="sm" asChild className="h-7 rounded-full text-xs">
            <a href={`${originalUrl}?download=1`} download>
              <Download width={14} height={14} strokeWidth={1.8} />
              下载原件
            </a>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            className="h-7 rounded-full text-xs text-[var(--color-text-secondary)]"
            onClick={() => void reparse()}
          >
            <Refresh width={14} height={14} strokeWidth={1.8} />
            重新解析
          </Button>
        </div>

        <div className="flex-1 overflow-auto px-4 py-3">
          {!detail ? (
            <p className="text-sm text-[var(--color-text-secondary)]">加载中…</p>
          ) : tab === "parsed" ? (
            editing ? (
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                aria-label="编辑解析内容"
                className="min-h-[50vh] w-full resize-y rounded-[var(--radius-md)] bg-[var(--color-panel)] p-3 font-mono text-xs outline-none focus:bg-[var(--color-project-surface-hover)]"
              />
            ) : variant === "enhanced" ? (
              enhancedError ? (
                <p className="text-sm text-[var(--color-error)]">{enhancedError}</p>
              ) : enhancedContent === null ? (
                <p className="text-sm text-[var(--color-text-secondary)]">加载中…</p>
              ) : (
                <MarkdownContent content={enhancedContent} resolveImageUrl={resolveImageUrl} />
              )
            ) : parsedContent ? (
              <MarkdownContent
                content={parsedContent}
                resolveImageUrl={resolveImageUrl}
              />
            ) : (
              <p className="text-sm text-[var(--color-text-secondary)]">
                {detail.status === "failed"
                  ? "解析失败，没有可展示的解析内容。可以在「原始文件」里查看原件，或尝试重新解析。"
                  : "这份文件还没有解析内容。"}
              </p>
            )
          ) : (
            <OriginalView
              mimeType={detail.mimeType}
              url={originalUrl}
              name={detail.originalName}
              status={detail.status}
            />
          )}
        </div>

        <div className="border-t border-[var(--color-border-light)] bg-[var(--color-panel-muted)] px-4 py-2">
          <div className="flex items-center justify-between gap-3">
            <button
              onClick={() => setQualityOpen((value) => !value)}
              aria-expanded={qualityOpen}
              className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            >
              解析质量
              {quality?.warningCount
                ? `：${quality.warningCount} 条提醒`
                : "：无提醒"}
              <span aria-hidden>{qualityOpen ? " ▾" : " ▸"}</span>
            </button>
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--color-text-secondary)]">{message}</span>
              {editing && (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!draft.trim()}
                  className="h-7 bg-[var(--color-project-action)] text-[var(--color-project-action-contrast)] hover:bg-[var(--color-project-action-hover)]"
                  onClick={() => void save()}
                >
                  保存修订
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 rounded-full text-xs text-[var(--color-error)]"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash width={14} height={14} strokeWidth={1.8} />
                删除
              </Button>
            </div>
          </div>

          {qualityOpen && (
            <dl className="mt-2 space-y-1 text-xs text-[var(--color-text-tertiary)]">
              <div className="flex gap-2">
                <dt className="w-20 shrink-0">解析器</dt>
                <dd>{String(detail?.processingMetadata?.parser ?? "未知")}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-20 shrink-0">解析时间</dt>
                <dd>
                  {String(
                    detail?.processingMetadata?.parseCompletedAt ??
                      detail?.updatedAt ??
                      ""
                  ).slice(0, 19).replace("T", " ")}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-20 shrink-0">结构统计</dt>
                <dd>
                  表格 {quality?.tableCount ?? 0} · 公式 {quality?.formulaCount ?? 0} · 图片{" "}
                  {quality?.imageRetainedCount ?? 0}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-20 shrink-0">索引状态</dt>
                <dd>
                  {embeddingStatus === "complete"
                    ? "完整"
                    : embeddingStatus
                      ? "不完整"
                      : "未建立"}
                </dd>
              </div>
              {detail?.projectId && (
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0">所属项目</dt>
                  <dd>
                    <Link
                      href={`/projects/${detail.projectId}`}
                      className="underline-offset-2 hover:underline"
                    >
                      {file.projectName ?? "打开项目"}
                    </Link>
                  </dd>
                </div>
              )}
            </dl>
          )}
        </div>
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除这份资料？</AlertDialogTitle>
            <AlertDialogDescription>
              「{detail?.originalName ?? file.originalName}」的原件、解析内容与检索分块都会被移除，无法恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void remove()}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** 按类型选择原件查看方式；无法可靠在线渲染的类型明确说明并给下载入口。 */
function OriginalView({
  mimeType,
  url,
  name,
  status,
}: {
  mimeType: string;
  url: string;
  name: string;
  status: string;
}) {
  if (status === "parsing" || status === "uploaded") {
    return (
      <p className="text-sm text-[var(--color-text-secondary)]">
        解析进行中，原件仍可下载查看。
      </p>
    );
  }

  if (PDF_PATTERN.test(mimeType)) {
    // 不交给浏览器内置查看器：部分嵌入子集字体的 PDF 在它那里会整页空白。
    return <PdfCanvasViewer url={url} title={name} />;
  }

  if (IMAGE_PATTERN.test(mimeType)) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={`${name} 原件`}
        className="mx-auto max-h-[65vh] w-auto rounded-[var(--radius-md)] object-contain"
      />
    );
  }

  if (TEXTUAL_PATTERN.test(mimeType)) {
    // 不能交给 iframe：`text/markdown` 这类类型配合 nosniff 不会被浏览器当作
    // 可渲染文档，iframe 会静默地什么都不加载（框架在、内容是空白）。
    return <TextOriginalView url={url} name={name} />;
  }

  if (OFFICE_PATTERN.test(mimeType)) {
    const office = <OfficeCanvasViewer url={url} mimeType={mimeType} title={name} />;
    // 只覆盖 .pptx/.docx/.xlsx 这类 OOXML；旧二进制格式与 WPS 自有格式
    // 仍然走「说明 + 下载原件」。
    if (OFFICE_OOXML_PATTERN.test(mimeType)) return office;
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="mb-1 text-sm font-medium text-[var(--color-text-primary)]">
          这类文件暂不支持在线预览
        </p>
        <p className="mb-5 max-w-sm text-sm text-[var(--color-text-tertiary)]">
          Office / WPS / iWork 文档需要用本机应用打开。解析内容仍可在上一个标签里查看。
        </p>
        <Button variant="secondary" size="sm" asChild>
          <a href={`${url}?download=1`} download>
            <Download width={15} height={15} strokeWidth={1.8} />
            下载原件
          </a>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <p className="mb-1 text-sm font-medium text-[var(--color-text-primary)]">
        暂不支持预览这种类型
      </p>
      <p className="mb-5 text-sm text-[var(--color-text-tertiary)]">
        {mimeType || "未知类型"}
      </p>
      <Button variant="secondary" size="sm" asChild>
        <a href={`${url}?download=1`} download>
          <Download width={15} height={15} strokeWidth={1.8} />
          下载原件
        </a>
      </Button>
    </div>
  );
}

/** 文本/代码类原件的原文查看器：自己取文本渲染，避免 iframe 对 text/* 的处理差异。 */
function TextOriginalView({ url, name }: { url: string; name: string }) {
  const [state, setState] = useState<{ text: string } | { error: true } | null>(null);

  useEffect(() => {
    let active = true;
    fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.text();
      })
      .then((text) => {
        if (active) setState({ text });
      })
      .catch(() => {
        if (active) setState({ error: true });
      });
    return () => {
      active = false;
    };
  }, [url]);

  if (!state) {
    return (
      <p className="py-12 text-center text-sm text-[var(--color-text-secondary)]">
        正在读取原件…
      </p>
    );
  }
  if ("error" in state) {
    return (
      <p className="py-12 text-center text-sm text-[var(--color-text-secondary)]">
        无法读取原件，可以下载后用本机应用打开。
      </p>
    );
  }
  return (
    <pre
      aria-label={`${name} 原件`}
      className="max-h-[65vh] overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-md)] bg-[var(--color-panel)] p-4 font-mono text-xs leading-relaxed text-[var(--color-text-primary)]"
    >
      {state.text}
    </pre>
  );
}
