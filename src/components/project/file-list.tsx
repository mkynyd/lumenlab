"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  NavArrowDown,
  NavArrowRight,
  Page,
} from "iconoir-react";
import { FILE_CATEGORIES } from "@/lib/file-categories";

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
  defaultGroupsCollapsed?: boolean;
  className?: string;
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

    return (
      <button
        key={file.id}
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
        className={cn(
          "flex h-8 w-full min-w-0 cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] px-2 text-left",
          "transition-[background-color,color] duration-150",
          selected
            ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
            : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
        )}
      >
        <Page width={14} height={14} strokeWidth={2} className="shrink-0 opacity-70" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {file.originalName}
        </span>
      </button>
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
                {open ? <NavArrowDown width={12} height={12} /> : <NavArrowRight width={12} height={12} />}
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
