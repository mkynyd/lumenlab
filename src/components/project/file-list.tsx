"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  CubeScan,
  Download,
  NavArrowDown,
  NavArrowRight,
  Page,
  Trash,
} from "iconoir-react";
import { FILE_CATEGORIES } from "@/lib/file-categories";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
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
  onFileAction?: (action: "delete" | "reparse" | "download", file: ProjectFile) => void;
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
  onFileAction,
  defaultGroupsCollapsed = false,
  className,
}: FileListProps) {
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<ProjectFile | null>(null);

  if (files.length === 0) {
    return null;
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

    const row = (
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
        className={cn(
          "flex h-8 w-full min-w-0 cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] px-2 text-left",
          "transition-[background-color,color] duration-150 focus-visible:outline-none focus-visible:bg-[var(--color-interaction-hover)]",
          selected
            ? "bg-[var(--color-interaction-active)] text-[var(--color-text-primary)]"
            : "text-[var(--color-text-secondary)] hover:bg-[var(--color-interaction-hover)] hover:text-[var(--color-text-primary)]"
        )}
      >
        <Page width={14} height={14} strokeWidth={2} className="shrink-0 opacity-70" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {file.originalName}
        </span>
      </button>
    );

    return (
      <ContextMenu key={file.id}>
        <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
        <ContextMenuContent className="min-w-32">
          <ContextMenuItem
            className="justify-start text-left"
            onSelect={() => onFileAction?.("download", file)}
          >
            <Download strokeWidth={2} />
            下载
          </ContextMenuItem>
          <ContextMenuItem
            className="justify-start text-left"
            onSelect={() => onFileAction?.("reparse", file)}
          >
            <CubeScan strokeWidth={2} />
            重新解析
          </ContextMenuItem>
          <ContextMenuItem
            variant="destructive"
            className="justify-start text-left"
            onSelect={() => setDeleteTarget(file)}
          >
            <Trash strokeWidth={2} />
            删除
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  return (
    <>
      <div className={cn("workbench-animated-list flex flex-col gap-1", className)}>
        {groupedFiles(files).map((group) => {
          const open = isGroupOpen(group.category);
          return (
            <div key={group.category} className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => toggleGroup(group.category)}
                className="flex h-7 w-full items-center justify-between rounded-[var(--radius-sm)] px-2 text-[11px] font-medium text-[var(--color-text-tertiary)] hover:bg-[var(--color-interaction-hover)] focus-visible:outline-none focus-visible:bg-[var(--color-interaction-hover)]"
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
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除文件</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除「{deleteTarget?.originalName}」吗？文件内容、解析结果和索引记录将无法恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (deleteTarget) {
                  onFileAction?.("delete", deleteTarget);
                  setDeleteTarget(null);
                }
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
