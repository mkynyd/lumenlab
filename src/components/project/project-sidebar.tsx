"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { FileUpload } from "@/components/project/file-upload";
import {
  FileList,
  type FileSelectionIntent,
  type ProjectFile,
} from "@/components/project/file-list";
import { Button } from "@/components/ui/button";
import { SelectMenu } from "@/components/ui/select-menu";
import { FILE_CATEGORIES, type FileCategory } from "@/lib/file-categories";
import {
  ArrowLeft,
  FolderOpen,
  MessageSquare,
  Plus,
  RotateCcw,
  Trash2,
  Download,
} from "lucide-react";
import { useProjectFiles } from "@/lib/hooks/use-project-files";
import { MathCurveLoader } from "@/components/workbench/math-curve-loader";

interface ProjectData {
  id: string;
  name: string;
  description: string | null;
  type: string;
  files?: ProjectFile[];
  conversations?: { id: string; title: string; updatedAt: string }[];
}

interface ProjectSidebarProps {
  project: ProjectData;
  selectedFileIds: Set<string>;
  onFileToggle: (id: string, intent: FileSelectionIntent) => void;
  onSelectAllFiles: () => void;
  onClearFileSelection: () => void;
  onSelectFilesByCategory: (category: FileCategory) => void;
  onFileDelete: (id: string) => void;
  onFileUploaded: () => void;
  onFileParse: (file: ProjectFile) => void;
  onFileEnhance: (file: ProjectFile) => void;
  onFileView: (file: ProjectFile) => void;
  onFileCategoryChange: (id: string, category: FileCategory | null) => void;
  onBatchDelete: () => void;
  onBatchReparse: () => void;
  onBatchAutoCategorize: () => void;
  onBatchReparseFailed: () => void;
  onBatchDownload: () => void;
  onNewConversation: () => void;
  onConversationSelect: (id: string) => void;
  onConversationDelete: (id: string, title: string) => void;
  activeConversationId?: string;
  className?: string;
}

const TYPE_LABELS: Record<string, string> = {
  experiment: "实验工作台",
  review: "资料复习",
  coding: "代码项目",
  general: "通用项目",
};

export function ProjectSidebar({
  project,
  selectedFileIds,
  onFileToggle,
  onSelectAllFiles,
  onClearFileSelection,
  onSelectFilesByCategory,
  onFileDelete,
  onFileUploaded,
  onFileParse,
  onFileEnhance,
  onFileView,
  onFileCategoryChange,
  onBatchDelete,
  onBatchReparse,
  onBatchAutoCategorize,
  onBatchReparseFailed,
  onBatchDownload,
  onNewConversation,
  onConversationSelect,
  onConversationDelete,
  activeConversationId,
  className,
}: ProjectSidebarProps) {
  const filesQuery = useProjectFiles(project.id, project.files || []);
  const files = filesQuery.data || project.files || [];
  const failedCount = files.filter((file) => file.status === "failed").length;
  const parsingCount = files.filter((file) => file.status === "parsing").length;
  const enhancingCount = files.filter((file) => file.enhancementStatus === "enhancing").length;
  const categorizableCount = files.filter((file) =>
    ["parsed", "partial"].includes(file.status)
  ).length;
  const selectedCount = selectedFileIds.size;
  const allSelected = files.length > 0 && selectedCount === files.length;
  const parsedCount = files.filter((file) => ["parsed", "partial"].includes(file.status)).length;

  return (
    <div className={cn("flex h-full flex-col overflow-hidden bg-[var(--color-panel)] backdrop-blur-[var(--glass-blur)]", className)}>
      <div className="grid shrink-0 grid-cols-2 gap-2 border-b border-[var(--color-border-light)] p-3">
        <Link
          href="/projects"
          className={cn(
            "inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-[var(--radius-md)] px-2 text-sm font-medium",
            "border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-primary)]",
            "transition-colors duration-150 hover:bg-[var(--color-surface-hover)]"
          )}
        >
          <ArrowLeft size={15} strokeWidth={2} />
          项目空间
        </Link>
        <Link
          href="/projects/new"
          className={cn(
            "inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-[var(--radius-md)] px-2 text-sm font-medium",
            "border border-transparent bg-[var(--color-accent)] text-[var(--color-accent-contrast)]",
            "transition-colors duration-150 hover:bg-[var(--color-accent-hover)]"
          )}
        >
          <Plus size={15} strokeWidth={2} />
          新建项目
        </Link>
      </div>

      {/* 项目信息 */}
      <div className="shrink-0 border-b border-[var(--color-border-light)] p-4">
        <div className="flex items-center gap-2 mb-1">
          <FolderOpen size={16} strokeWidth={2} className="text-[var(--color-text-tertiary)]" />
          <h2 className="text-sm font-semibold truncate text-[var(--color-text-primary)]">
            {project.name}
          </h2>
        </div>
        <p className="text-[10px] text-[var(--color-text-tertiary)] uppercase tracking-wider">
          {TYPE_LABELS[project.type] || project.type}
        </p>
        {project.description && (
          <p className="text-xs text-[var(--color-text-secondary)] mt-1 line-clamp-2">
            {project.description}
          </p>
        )}
        <div className="mt-3 grid grid-cols-2 gap-1.5">
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border-light)] bg-[var(--color-surface)] px-2 py-1.5">
            <p className="font-mono text-[11px] text-[var(--color-text-primary)]">{files.length}</p>
            <p className="text-[10px] text-[var(--color-text-tertiary)]">资料</p>
          </div>
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border-light)] bg-[var(--color-surface)] px-2 py-1.5">
            <p className="font-mono text-[11px] text-[var(--color-text-primary)]">{parsedCount}</p>
            <p className="text-[10px] text-[var(--color-text-tertiary)]">可检索</p>
          </div>
        </div>
      </div>

      {/* 文件区域 */}
      <div className="flex-1 overflow-y-auto">
        <div className="border-b border-[var(--color-border-light)] px-3 py-2">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <span className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-tertiary)]">
                资料索引
              </span>
              <p className="mt-0.5 text-[10px] text-[var(--color-text-tertiary)]">
                选择文件会显式参与下一轮回答
              </p>
            </div>
            <span className="rounded-[var(--radius-md)] border border-[var(--color-border-light)] bg-[var(--color-surface)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--color-text-tertiary)]">
              {selectedCount}/{files.length}
            </span>
          </div>
          {(parsingCount > 0 || enhancingCount > 0) && (
            <div className="mb-2 rounded-[var(--radius-lg)] border border-[var(--color-info-muted)] bg-[var(--color-info-muted)] px-2 py-1.5">
              <MathCurveLoader
                size="sm"
                variant="lissajous"
                label={parsingCount > 0 ? "资料解析中" : "知识增强中"}
                detail={[
                  parsingCount > 0 ? `${parsingCount} 个解析队列` : null,
                  enhancingCount > 0 ? `${enhancingCount} 个增强队列` : null,
                ].filter(Boolean).join("，")}
              />
            </div>
          )}
          <div className="mb-2 workbench-action-card p-2">
            <div className="grid grid-cols-[1fr_1fr] gap-1.5">
              <Button
                variant={allSelected ? "secondary" : "primary"}
                size="sm"
                onClick={allSelected ? onClearFileSelection : onSelectAllFiles}
                disabled={files.length === 0}
                className="w-full"
              >
                {allSelected ? "取消" : "全选"}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={onBatchReparseFailed}
                disabled={failedCount === 0}
                className="w-full"
              >
                <RotateCcw size={13} />
                重新解析
              </Button>
            </div>
            <div className="mt-1.5 grid grid-cols-[1fr_1fr] gap-1.5">
              <SelectMenu
                ariaLabel="筛选"
                placeholder="筛选"
                disabled={files.length === 0}
                labelAlign="center"
                options={FILE_CATEGORIES.map((category) => ({
                  value: category,
                  label: category,
                }))}
                onChange={(value) => onSelectFilesByCategory(value as FileCategory)}
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={onBatchAutoCategorize}
                disabled={categorizableCount === 0}
                className="w-full"
              >
                重新分类
              </Button>
            </div>
          </div>
          {selectedCount > 0 && (
            <div className="workbench-border-glow mb-2 rounded-[var(--radius-xl)] border border-[var(--color-accent)] bg-[var(--color-accent-soft)] p-2">
              <p className="mb-1.5 px-1 text-[10px] font-medium uppercase tracking-wider text-[var(--color-accent)]">
                当前上下文 · {selectedCount} 个文件
              </p>
              <div className="grid grid-cols-3 gap-1.5">
                <Button variant="secondary" size="sm" onClick={onBatchDelete} className="w-full hover:border-[var(--color-error)] hover:text-[var(--color-error)]">
                  <Trash2 size={13} />
                  删除
                </Button>
                <Button variant="secondary" size="sm" onClick={onBatchReparse} className="w-full">
                  <RotateCcw size={13} />
                  解析
                </Button>
                <Button variant="secondary" size="sm" onClick={onBatchDownload} className="w-full">
                  <Download size={13} />
                  下载
                </Button>
              </div>
            </div>
          )}
          <FileUpload
            projectId={project.id}
            onUploaded={onFileUploaded}
          />
          <FileList
            files={files}
            selectedIds={selectedFileIds}
            onToggle={onFileToggle}
            onDelete={onFileDelete}
            onParse={onFileParse}
            onEnhance={onFileEnhance}
            onView={onFileView}
            onCategoryChange={onFileCategoryChange}
            defaultGroupsCollapsed
            className="mt-2"
          />
        </div>

        {/* 对话列表 */}
        <div className="px-3 py-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider">
              项目对话
            </span>
            <Button variant="ghost" size="sm" onClick={onNewConversation}>
              <Plus size={12} strokeWidth={2} />
            </Button>
          </div>
          {project.conversations && project.conversations.length > 0 ? (
            <div className="space-y-0.5">
              {project.conversations.map((conv) => (
                <div
                  key={conv.id}
                  className={cn(
                    "group flex w-full items-center gap-1 rounded-[var(--radius-md)] pr-1",
                    "text-xs transition-colors duration-100 hover:bg-[var(--color-surface-hover)]",
                    activeConversationId === conv.id
                      ? "bg-[var(--color-accent-muted)] text-[var(--color-accent)]"
                      : "text-[var(--color-text-secondary)]"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onConversationSelect(conv.id)}
                    className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-md)] px-2 text-left"
                  >
                    <MessageSquare size={12} strokeWidth={2} className="shrink-0 opacity-70" />
                    <span className="truncate flex-1">{conv.title}</span>
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onConversationDelete(conv.id, conv.title);
                    }}
                    className="inline-flex size-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] opacity-0 transition-opacity duration-150 hover:bg-[var(--color-error-muted)] hover:text-[var(--color-error)] group-hover:opacity-100 focus-visible:opacity-100"
                    aria-label={`删除项目对话 ${conv.title}`}
                    title="删除"
                  >
                    <Trash2 size={12} strokeWidth={2} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-[var(--color-text-tertiary)] py-2">
              暂无对话
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
