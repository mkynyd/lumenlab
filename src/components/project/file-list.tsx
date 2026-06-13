"use client";

import { cn } from "@/lib/utils";
import { FileText, Check, AlertCircle, Trash2, XCircle } from "lucide-react";

export interface ProjectFile {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  status: string;
  createdAt: string;
}

interface FileListProps {
  files: ProjectFile[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onDelete?: (id: string) => void;
  className?: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileList({
  files,
  selectedIds,
  onToggle,
  onDelete,
  className,
}: FileListProps) {
  if (files.length === 0) {
    return (
      <p className={cn("text-xs leading-relaxed text-[var(--color-text-tertiary)] py-4 text-center", className)}>
        上传实验数据、代码、课件、试卷或笔记，开始构建项目上下文。
      </p>
    );
  }

  return (
    <div className={cn("space-y-0.5", className)}>
      {files.map((file) => {
        const selected = selectedIds.has(file.id);
        return (
          <div
            key={file.id}
            className={cn(
              "flex items-center rounded-[var(--radius-md)]",
              "transition-colors duration-100",
              selected
                ? "bg-[var(--color-accent-muted)] border border-[var(--color-accent)]"
                : "border border-transparent hover:bg-[var(--color-surface-hover)]"
            )}
          >
            <button
              type="button"
              role="checkbox"
              aria-checked={selected}
              aria-label={`选择文件 ${file.originalName}`}
              onClick={() => onToggle(file.id)}
              className="flex flex-1 min-w-0 items-center gap-2 px-2 py-1.5 text-left"
            >
              <FileText size={14} strokeWidth={2} className="shrink-0 opacity-70" />
              <div className="flex-1 min-w-0">
                <p className="text-xs truncate text-[var(--color-text-primary)]">
                  {file.originalName}
                </p>
                <p className="text-[10px] font-mono text-[var(--color-text-tertiary)]">
                  {formatSize(file.size)} ·{" "}
                  {file.status === "parsed" ? (
                    <span className="text-[var(--color-success)]">
                      <Check size={10} strokeWidth={2} className="inline mr-0.5" />
                      已解析，可用于上下文
                    </span>
                  ) : file.status === "failed" ? (
                    <span className="text-[var(--color-error)]">
                      <XCircle size={10} strokeWidth={2} className="inline mr-0.5" />
                      解析失败
                    </span>
                  ) : (
                    <span className="text-[var(--color-warning)]">
                      <AlertCircle size={10} strokeWidth={2} className="inline mr-0.5" />
                      已保存，当前版本暂未解析该类型内容
                    </span>
                  )}
                </p>
              </div>
            </button>
            {onDelete && (
              <button
                type="button"
                onClick={() => onDelete(file.id)}
                className="mr-1 shrink-0 p-0.5 text-[var(--color-text-tertiary)] hover:text-[var(--color-error)] transition-colors"
                aria-label={`删除 ${file.originalName}`}
              >
                <Trash2 size={12} strokeWidth={2} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
