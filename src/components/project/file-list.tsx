"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  CubeScan,
  Download,
  Eye,
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Spinner } from "@/components/ui/spinner";

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
  onFileAction?: (action: "delete" | "reparse" | "download" | "preview", file: ProjectFile) => void;
  defaultGroupsCollapsed?: boolean;
  searchQuery?: string;
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
  searchQuery = "",
  className,
}: FileListProps) {
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<ProjectFile | null>(null);

  const filteredFiles = searchQuery.trim()
    ? files.filter((file) =>
        file.originalName.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : files;

  if (files.length === 0) {
    return null;
  }

  function isGroupOpen(category: string) {
    return defaultGroupsCollapsed ? openGroups.has(category) : !openGroups.has(category);
  }

  function setGroupOpen(category: string, open: boolean) {
    setOpenGroups((current) => {
      const next = new Set(current);
      const shouldStore = defaultGroupsCollapsed ? open : !open;
      if (shouldStore) next.add(category);
      else next.delete(category);
      return next;
    });
  }

  function renderFile(file: ProjectFile, index: number) {
    const selected = selectedIds.has(file.id);
    const parsing = file.status === "parsing";

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
          "transition-[background-color,color] duration-150 focus-visible:outline-none focus-visible:bg-[var(--color-project-surface-hover)] focus-visible:text-[var(--color-text-primary)]",
          selected
            ? "bg-[var(--color-project-surface-active)] text-[var(--color-text-primary)] font-semibold"
            : "text-[var(--color-text-secondary)] hover:bg-[var(--color-project-surface-hover)] hover:text-[var(--color-text-primary)]"
        )}
      >
        {parsing ? (
          <Spinner className="shrink-0 text-[var(--color-text-tertiary)]" />
        ) : (
          <Page width={14} height={14} strokeWidth={2} className="shrink-0 opacity-70" />
        )}
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {file.originalName}
        </span>
        {parsing && (
          <span className="shrink-0 text-[10px] text-[var(--color-text-tertiary)]">
            解析中
          </span>
        )}
      </button>
    );

    return (
      <ContextMenu key={file.id}>
        <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
        <ContextMenuContent className="min-w-32">
          <ContextMenuItem
            className="justify-start text-left"
            onSelect={() => onFileAction?.("preview", file)}
          >
            <Eye strokeWidth={2} />
            预览
          </ContextMenuItem>
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
        {groupedFiles(filteredFiles).map((group) => {
          const open = isGroupOpen(group.category);
          const fileCount = group.files.length;
          return (
            <Collapsible
              key={group.category}
              open={open}
              onOpenChange={(nextOpen) => setGroupOpen(group.category, nextOpen)}
              className="flex flex-col gap-1"
            >
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex h-7 w-full items-center justify-between rounded-[var(--radius-sm)] px-2 text-[11px] font-medium text-[var(--color-text-tertiary)] hover:bg-[var(--color-project-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:bg-[var(--color-project-surface-hover)] focus-visible:text-[var(--color-text-primary)]"
                  aria-expanded={open}
                >
                  <span className="inline-flex items-center gap-1">
                    <NavArrowRight
                      width={12}
                      height={12}
                      className={cn(
                        "transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
                        open && "rotate-90"
                      )}
                    />
                    {group.category}
                  </span>
                  <span className="font-mono">{group.files.length}</span>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="min-h-0 overflow-hidden pt-1">
                  <div className="flex flex-col gap-1">
                    {group.files.map((file, i) => {
                      const delay = open
                        ? `${i * 35}ms`
                        : `${(fileCount - 1 - i) * 30}ms`;
                      return (
                        <div
                          key={file.id}
                          style={{ transitionDelay: delay }}
                          className={cn(
                            "collapsible-item",
                            open ? "opacity-100" : "opacity-0"
                          )}
                        >
                          {renderFile(file, files.indexOf(file))}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
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
