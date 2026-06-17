"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  FileText,
  Check,
  AlertCircle,
  Trash2,
  XCircle,
  Eye,
  Sparkles,
  ScanText,
  Loader,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { FILE_CATEGORIES, type FileCategory } from "@/lib/file-categories";
import { Button } from "@/components/ui/button";
import { MathCurveLoader } from "@/components/workbench/math-curve-loader";

export interface ProjectFile {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  status: string;
  category?: string | null;
  categoryConfidence?: number | null;
  enhancementStatus?: string;
  processingMetadata?: Record<string, unknown> | null;
  createdAt: string;
}

export interface FileSelectionIntent {
  range: boolean;
  additive: boolean;
  index: number;
}

interface FileListProps {
  files: ProjectFile[];
  selectedIds: Set<string>;
  onToggle: (id: string, intent: FileSelectionIntent) => void;
  onDelete?: (id: string) => void;
  onParse?: (file: ProjectFile) => void;
  onEnhance?: (file: ProjectFile) => void;
  onView?: (file: ProjectFile) => void;
  onCategoryChange?: (id: string, category: FileCategory | null) => void;
  defaultGroupsCollapsed?: boolean;
  className?: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusLabel(file: ProjectFile) {
  const parser = file.processingMetadata?.parser;
  const chipClass = "inline-flex items-center gap-0.5 rounded-[var(--radius-sm)] px-1.5 py-0.5";
  if (file.status === "parsed") {
    const base =
      parser === "pdf-text"
        ? "已提取文本"
        : parser === "minimax-pdf-vision" || parser === "minimax-pdf-native"
          ? "已通过视觉解析"
          : parser === "mineru-pipeline"
          ? "已通过 MinerU 解析"
          : "已解析，可用于检索";
    const enhanced =
      file.enhancementStatus === "enhanced"
        ? " · 已增强"
        : file.enhancementStatus === "enhancing"
          ? " · 增强中"
        : file.enhancementStatus === "stale"
          ? " · 增强已过期"
          : "";
    return <span className={cn(chipClass, "bg-[var(--color-success-muted)] text-[var(--color-success)]")}><Check size={10} />{base}{enhanced}</span>;
  }
  if (file.status === "partial") {
    return <span className={cn(chipClass, "bg-[var(--color-warning-muted)] text-[var(--color-warning)]")}><AlertCircle size={10} />部分解析成功</span>;
  }
  if (file.status === "parsing") {
    return <span className={cn(chipClass, "bg-[var(--color-info-muted)] text-[var(--color-info)]")}>解析中</span>;
  }
  if (file.status === "failed") {
    return <span className={cn(chipClass, "bg-[var(--color-error-muted)] text-[var(--color-error)]")}><XCircle size={10} />解析失败</span>;
  }
  if (file.status === "unsupported") {
    return <span>暂不支持</span>;
  }
  return <span className={cn(chipClass, "bg-[var(--color-warning-muted)] text-[var(--color-warning)]")}><AlertCircle size={10} />待解析</span>;
}

function parsingStageLabel(file: ProjectFile) {
  const stage = file.processingMetadata?.parsingStage;
  if (stage === "uploading") return "上传文件中";
  if (stage === "converting") return "转换格式中";
  if (stage === "pending") return "排队等待中";
  if (stage === "model") return "模型解析中";
  if (stage === "writing") return "写入中";
  if (stage === "complete") return "完成";
  return "模型解析中";
}

function parsingProgress(file: ProjectFile) {
  const raw = file.processingMetadata?.progress;
  if (!raw || typeof raw !== "object") return null;
  const progress = raw as Record<string, unknown>;
  const extractedPages = typeof progress.extractedPages === "number"
    ? progress.extractedPages
    : null;
  const totalPages = typeof progress.totalPages === "number"
    ? progress.totalPages
    : null;
  if (extractedPages == null || totalPages == null || totalPages <= 0) {
    return null;
  }
  return { extractedPages, totalPages };
}

function categoryLabel(file: ProjectFile) {
  if (file.category && (file.categoryConfidence ?? 1) >= 0.7) {
    return file.category;
  }
  return "未分类";
}

function groupedFiles(files: ProjectFile[]) {
  const order = [...FILE_CATEGORIES, "未分类"];
  return order
    .map((category) => ({
      category,
      files: files.filter((file) => categoryLabel(file) === category),
    }))
    .filter((group) => group.files.length > 0);
}

export function FileList({
  files,
  selectedIds,
  onToggle,
  onDelete,
  onParse,
  onEnhance,
  onView,
  onCategoryChange,
  defaultGroupsCollapsed = false,
  className,
}: FileListProps) {
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  if (files.length === 0) {
    return (
      <p className={cn("text-xs leading-relaxed text-[var(--color-text-tertiary)] py-4 text-center", className)}>
        上传实验数据、代码、课件、试卷或笔记，开始构建项目上下文。
      </p>
    );
  }

  function isGroupOpen(category: string) {
    return defaultGroupsCollapsed ? openGroups.has(category) : !openGroups.has(category);
  }

  function toggleGroup(category: string) {
    setOpenGroups((current) => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  function renderFile(file: ProjectFile, index: number) {
    const selected = selectedIds.has(file.id);
    const canParse =
      ["uploaded", "failed"].includes(file.status);
    const canEnhance =
      ["parsed", "partial"].includes(file.status) &&
      file.enhancementStatus !== "enhancing";
    const progress = parsingProgress(file);

    return (
      <div
        key={file.id}
        className={cn(
          "rounded-[var(--radius-lg)] border transition-colors duration-150",
          selected
            ? "workbench-glow border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
            : "border-transparent bg-transparent hover:bg-[var(--color-surface-hover)]"
        )}
      >
        <div className="p-1">
          <button
            type="button"
            role="checkbox"
            aria-checked={selected}
            aria-label={`选择文件 ${file.originalName}`}
            onClick={(event) =>
              onToggle(file.id, {
                range: event.shiftKey,
                additive: event.metaKey || event.ctrlKey,
                index,
              })
            }
            className="flex w-full min-w-0 items-start gap-2 rounded-[var(--radius-md)] px-2 py-1.5 text-left hover:bg-[var(--color-surface-hover)]"
          >
            <FileText size={14} className="mt-0.5 shrink-0 opacity-70" />
            <div className="flex-1 min-w-0">
              <p className="truncate text-xs font-medium">{file.originalName}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] font-mono text-[var(--color-text-tertiary)]">
                <span>{formatSize(file.size)}</span>
                {statusLabel(file)}
              </p>
              {file.status === "parsing" && (
                <div className="mt-1 space-y-1 rounded-[var(--radius-md)] border border-[var(--color-border-light)] bg-[var(--color-panel)] px-2 py-1.5">
                  <div
                    role="progressbar"
                    aria-label={`${file.originalName} 解析进度`}
                    className="h-1 w-full overflow-hidden rounded-full bg-[var(--color-ring-track)]"
                  >
                    <div className="h-full w-1/2 animate-pulse rounded-full bg-[var(--color-info)]" />
                  </div>
                  <MathCurveLoader
                    size="sm"
                    variant="rose"
                    label={progress
                      ? `解析中：${progress.extractedPages}/${progress.totalPages} 页`
                      : parsingStageLabel(file)}
                  />
                </div>
              )}
            </div>
          </button>
          <div className="mt-1 flex flex-wrap items-center gap-1 border-t border-[var(--color-border-light)] px-1 pt-1">
            {onCategoryChange && (
              <select
                value={file.category || ""}
                onChange={(event) =>
                  onCategoryChange(
                    file.id,
                    event.target.value ? (event.target.value as FileCategory) : null
                  )
                }
                onClick={(event) => event.stopPropagation()}
                className="h-7 min-w-24 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-1 text-[10px]"
                aria-label={`修改 ${file.originalName} 分类`}
              >
                <option value="">未分类</option>
                {FILE_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            )}
            {file.status === "parsing" && <Loader size={12} className="animate-spin text-[var(--color-info)]" />}
            {canParse && onParse && (
              <Button type="button" variant="ghost" size="sm" onClick={() => onParse(file)} aria-label={`解析 ${file.originalName}`} title="重新解析">
                <ScanText size={12} />
              </Button>
            )}
            {canEnhance && onEnhance && (
              <Button type="button" variant="ghost" size="sm" onClick={() => onEnhance(file)} aria-label={`知识增强 ${file.originalName}`} title="知识增强">
                <Sparkles size={12} />
              </Button>
            )}
            {["parsed", "partial"].includes(file.status) && onView && (
              <Button type="button" variant="ghost" size="sm" onClick={() => onView(file)} aria-label={`查看 ${file.originalName}`} title="查看解析结果">
                <Eye size={12} />
              </Button>
            )}
            {onDelete && (
              <Button type="button" variant="ghost" size="sm" onClick={() => onDelete(file.id)} aria-label={`删除 ${file.originalName}`}>
                <Trash2 size={12} />
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("workbench-animated-list space-y-1", className)}>
      {groupedFiles(files).map((group) => {
        const open = isGroupOpen(group.category);
        return (
          <div key={group.category} className="space-y-1">
            <button
              type="button"
              onClick={() => toggleGroup(group.category)}
              className="flex h-7 w-full items-center justify-between rounded-[var(--radius-md)] px-2 text-[11px] font-medium text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)]"
              aria-expanded={open}
            >
              <span className="inline-flex items-center gap-1">
                {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                {group.category}
              </span>
              <span className="font-mono">{group.files.length}</span>
            </button>
            {open && group.files.map((file) => renderFile(file, files.indexOf(file)))}
          </div>
        );
      })}
    </div>
  );
}
