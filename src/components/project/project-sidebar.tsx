"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { FileUpload } from "@/components/project/file-upload";
import {
  FileList,
  type FileSelectionIntent,
  type ProjectFile,
} from "@/components/project/file-list";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarProvider,
} from "@/components/ui/sidebar";
import {
  CheckCircle,
  CheckCircleSolid,
  Download,
  Folder,
  NavArrowLeft,
  Plus,
  RefreshDouble,
  Search,
  Trash,
  Xmark,
  ChatLines,
  MoreHoriz,
  InfoCircle,
  Box3dCenter,
  Network,
} from "iconoir-react";
import { ProjectDetailModal } from "@/components/project/project-detail-modal";
import { useProjectFiles } from "@/lib/hooks/use-project-files";
import { useProjectArtifacts } from "@/lib/hooks/use-artifacts";

interface ProjectData {
  id: string;
  name: string;
  description: string | null;
  type: string;
  systemPrompt?: string | null;
  files?: ProjectFile[];
  conversations?: { id: string; title: string; updatedAt: string }[];
}

interface ProjectSidebarProps {
  project: ProjectData;
  onShowArtifacts?: () => void;
  onShowVectorLibrary?: () => void;
  selectedFileIds: Set<string>;
  onFileToggle: (id: string, intent: FileSelectionIntent) => void;
  onSelectAllFiles: () => void;
  onClearFileSelection: () => void;
  onFileUploaded: () => void;
  onBatchDelete: () => void;
  onBatchReparse: () => void;
  onBatchReparseFailed: () => void;
  onBatchDownload: () => void;
  onFileAction: (action: "delete" | "reparse" | "download" | "preview", fileId: string) => void;
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
  onFileUploaded,
  onBatchDelete,
  onBatchReparse,
  onBatchReparseFailed,
  onBatchDownload,
  onFileAction,
  onNewConversation,
  onConversationSelect,
  onConversationDelete,
  activeConversationId,
  onShowArtifacts,
  onShowVectorLibrary,
  className,
}: ProjectSidebarProps) {
  const filesQuery = useProjectFiles(project.id, project.files || []);
  const files = filesQuery.data || project.files || [];
  const failedCount = files.filter((file) => file.status === "failed").length;
  const selectedCount = selectedFileIds.size;
  const allSelected = files.length > 0 && selectedCount === files.length;
  const [fileSearch, setFileSearch] = useState("");
  const [sidebarTab, setSidebarTab] = useState<"files" | "conversations">("files");
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [conversationDeleteTarget, setConversationDeleteTarget] = useState<{
    id: string;
    title: string;
  } | null>(null);

  const artifactsQuery = useProjectArtifacts(project.id);
  const artifactCount = artifactsQuery.data?.length ?? 0;
  const conversationCount = project.conversations?.length ?? 0;
  const fileCount = files.length;

  return (
    <SidebarProvider defaultOpen className="h-full min-h-0 w-full overflow-hidden">
    <div className={cn("flex h-full w-full min-w-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground backdrop-blur-[var(--glass-blur)]", className)}>
      <SidebarHeader className="shrink-0 px-3 pb-2 pt-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <Button
            asChild
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-[var(--color-text-tertiary)] hover:bg-[var(--color-interaction-hover)] hover:text-[var(--color-text-primary)] focus-visible:bg-[var(--color-interaction-hover)]"
          >
            <Link href="/projects" aria-label="返回项目空间">
              <NavArrowLeft strokeWidth={2} />
            </Link>
          </Button>
          <Folder
            width={16}
            height={16}
            strokeWidth={1.8}
            className="shrink-0 text-[var(--color-text-tertiary)]"
          />
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--color-text-primary)]">
            {project.name}
          </h2>
          <button
            type="button"
            onClick={() => setDetailOpen(true)}
            className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-interaction-hover)] transition-colors"
            aria-label="查看项目详情"
          >
            <InfoCircle width={14} height={14} strokeWidth={1.5} />
          </button>
        </div>
        <p className="mt-1 truncate pl-14 text-[11px] text-[var(--color-text-tertiary)]">
          {TYPE_LABELS[project.type] || project.type}
        </p>
        {project.description && (
          <p className="mt-1 line-clamp-2 pl-14 text-xs leading-relaxed text-[var(--color-text-secondary)]">
            {project.description}
          </p>
        )}
      </SidebarHeader>

      <div
        className="mx-3 mb-1 flex shrink-0 rounded-[var(--radius-md)] bg-[var(--color-project-control)] p-0.5"
        role="group"
        aria-label="项目侧栏视图"
      >
        <button
          type="button"
          onClick={() => setSidebarTab("files")}
          aria-pressed={sidebarTab === "files"}
          className={cn(
            "flex-1 rounded-[calc(var(--radius-md)-2px)] py-1.5 text-xs font-medium transition-[background-color,color,box-shadow] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
            sidebarTab === "files"
              ? "bg-[var(--color-surface)] text-[var(--color-text-primary)] shadow-[0_1px_2px_rgba(0,0,0,0.05)] dark:shadow-none"
              : "text-[var(--color-text-tertiary)] hover:bg-[var(--color-project-surface-hover)] hover:text-[var(--color-text-primary)]"
          )}
        >
          资料 ({files.length})
        </button>
        <button
          type="button"
          onClick={() => setSidebarTab("conversations")}
          aria-pressed={sidebarTab === "conversations"}
          className={cn(
            "flex-1 rounded-[calc(var(--radius-md)-2px)] py-1.5 text-xs font-medium transition-[background-color,color,box-shadow] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
            sidebarTab === "conversations"
              ? "bg-[var(--color-surface)] text-[var(--color-text-primary)] shadow-[0_1px_2px_rgba(0,0,0,0.05)] dark:shadow-none"
              : "text-[var(--color-text-tertiary)] hover:bg-[var(--color-project-surface-hover)] hover:text-[var(--color-text-primary)]"
          )}
        >
          对话 ({project.conversations?.length || 0})
        </button>
      </div>

      {/* Tab: Files */}
      {sidebarTab === "files" && (
      <SidebarContent className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 pb-3">
        <SidebarGroup className="flex min-h-0 flex-1 flex-col px-0 py-1">
          <div className="mb-2 flex items-center gap-1.5">
            <div className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-project-control)] px-2">
              <Search
                width={13}
                height={13}
                className="shrink-0 text-[var(--color-text-tertiary)]"
              />
              <input
                type="text"
                name="project-file-search"
                value={fileSearch}
                onChange={(event) => setFileSearch(event.target.value)}
                placeholder="搜索资料"
                aria-label="搜索项目资料"
                autoComplete="off"
                className="min-w-0 flex-1 bg-transparent text-xs text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
              />
              {fileSearch && (
                <button
                  type="button"
                  onClick={() => setFileSearch("")}
                  className="shrink-0 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
                  aria-label="清除搜索"
                >
                  <Xmark width={12} height={12} />
                </button>
              )}
            </div>
            <FileUpload
              projectId={project.id}
              onUploaded={onFileUploaded}
              triggerClassName="h-8 w-8 rounded-[var(--radius-md)] border-0 bg-[var(--color-project-action)] text-[var(--color-project-action-contrast)] hover:bg-[var(--color-project-action-hover)] hover:text-[var(--color-project-action-contrast)] focus-visible:bg-[var(--color-project-action-hover)]"
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="h-8 w-8 rounded-[var(--radius-md)] text-[var(--color-text-tertiary)] hover:bg-[var(--color-interaction-hover)] hover:text-[var(--color-text-primary)] focus-visible:bg-[var(--color-interaction-hover)]"
                  aria-label="更多资料操作"
                >
                  <MoreHoriz strokeWidth={2} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem
                  disabled={files.length === 0}
                  onSelect={
                    allSelected ? onClearFileSelection : onSelectAllFiles
                  }
                >
                  {allSelected ? (
                    <CheckCircleSolid strokeWidth={2} />
                  ) : (
                    <CheckCircle strokeWidth={2} />
                  )}
                  {allSelected ? "取消全选" : "全选"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={failedCount === 0}
                  onSelect={onBatchReparseFailed}
                >
                  <RefreshDouble strokeWidth={2} />
                  重试失败项
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={selectedCount === 0}
                  onSelect={onBatchReparse}
                >
                  <RefreshDouble strokeWidth={2} />
                  重新解析
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={selectedCount === 0}
                  onSelect={onBatchDownload}
                >
                  <Download strokeWidth={2} />
                  下载
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  disabled={selectedCount === 0}
                  onSelect={() => setBatchDeleteOpen(true)}
                >
                  <Trash strokeWidth={2} />
                  删除
                </DropdownMenuItem>
                {(onShowArtifacts || onShowVectorLibrary) && (
                  <DropdownMenuSeparator />
                )}
                {onShowArtifacts && (
                  <DropdownMenuItem onSelect={onShowArtifacts}>
                    <Box3dCenter strokeWidth={2} />
                    成果库
                    {artifactCount > 0 && (
                      <span className="ml-auto text-[10px] text-[var(--color-text-tertiary)]">
                        {artifactCount}
                      </span>
                    )}
                  </DropdownMenuItem>
                )}
                {onShowVectorLibrary && (
                  <DropdownMenuItem onSelect={onShowVectorLibrary}>
                    <Network strokeWidth={2} />
                    资料图谱
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {selectedCount > 0 && (
            <p className="mb-1 px-1 text-[11px] text-[var(--color-text-tertiary)]">
              已选 {selectedCount} 项作为上下文
            </p>
          )}
          <AlertDialog open={batchDeleteOpen} onOpenChange={setBatchDeleteOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>删除资料</AlertDialogTitle>
                <AlertDialogDescription>
                  确定要删除已选择的 {selectedCount} 个文件吗？文件内容、解析结果和索引记录将无法恢复。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => {
                    onBatchDelete();
                    setBatchDeleteOpen(false);
                  }}
                >
                  删除
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <ScrollArea className="h-full min-h-0 w-full overflow-x-hidden">
            <FileList
              files={files}
              selectedIds={selectedFileIds}
              onToggle={onFileToggle}
              onFileAction={(action, file) => onFileAction(action, file.id)}
              searchQuery={fileSearch}
              className="w-full overflow-hidden"
            />
          </ScrollArea>
        </SidebarGroup>
      </SidebarContent>
      )}

      {/* Tab: Conversations */}
      {sidebarTab === "conversations" && (
      <SidebarContent className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 pb-3">
        <SidebarGroup className="flex min-h-0 flex-1 flex-col px-0 py-2">
          <div className="mb-2 flex items-center justify-between gap-2 px-1">
            <span className="text-[11px] font-medium text-[var(--color-text-tertiary)]">
              项目对话
            </span>
            <button
              type="button"
              onClick={onNewConversation}
              className="inline-flex h-8 shrink-0 items-center gap-1 rounded-[var(--radius-md)] bg-[var(--color-project-action)] px-2.5 text-xs font-medium text-[var(--color-project-action-contrast)] transition-colors duration-150 hover:bg-[var(--color-project-action-hover)] focus-visible:bg-[var(--color-project-action-hover)]"
            >
              <Plus width={13} height={13} strokeWidth={2} />
              新对话
            </button>
          </div>
          <SidebarGroupContent className="flex min-h-0 flex-1 flex-col">
            <ScrollArea className="h-full min-h-0 w-full overflow-x-hidden">
              {project.conversations && project.conversations.length > 0 ? (
                <div className="flex w-full flex-col gap-1 overflow-hidden">
                  {project.conversations.map((conv) => {
                    const active = activeConversationId === conv.id;
                    const row = (
                      <button
                        type="button"
                        onClick={() => onConversationSelect(conv.id)}
                        className={cn(
                          "flex h-8 w-full min-w-0 cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] px-2 text-left text-xs",
                          "transition-[background-color,color] duration-150 focus-visible:bg-[var(--color-project-surface-hover)] focus-visible:text-[var(--color-text-primary)]",
                          active
                            ? "bg-[var(--color-project-surface-active)] font-semibold text-[var(--color-text-primary)]"
                            : "text-[var(--color-text-secondary)] hover:bg-[var(--color-project-surface-hover)] hover:text-[var(--color-text-primary)]"
                        )}
                      >
                        <ChatLines
                          width={14}
                          height={14}
                          strokeWidth={2}
                          className="shrink-0 opacity-70"
                        />
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {conv.title}
                        </span>
                      </button>
                    );
                    return (
                      <ContextMenu key={conv.id}>
                        <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
                        <ContextMenuContent className="min-w-36">
                          <ContextMenuItem
                            onSelect={() => onConversationSelect(conv.id)}
                          >
                            <ChatLines strokeWidth={2} />
                            打开
                          </ContextMenuItem>
                          <ContextMenuItem
                            variant="destructive"
                            onSelect={() => setConversationDeleteTarget(conv)}
                          >
                            <Trash strokeWidth={2} />
                            删除
                          </ContextMenuItem>
                        </ContextMenuContent>
                      </ContextMenu>
                    );
                  })}
                </div>
              ) : (
                <p className="px-2 py-2 text-xs text-[var(--color-text-tertiary)]">
                  暂无对话
                </p>
              )}
            </ScrollArea>
          </SidebarGroupContent>
          <AlertDialog
            open={conversationDeleteTarget !== null}
            onOpenChange={(open) => {
              if (!open) setConversationDeleteTarget(null);
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>删除对话</AlertDialogTitle>
                <AlertDialogDescription>
                  确定要删除「{conversationDeleteTarget?.title}」吗？这条对话记录将无法恢复。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => {
                    if (conversationDeleteTarget) {
                      onConversationDelete(
                        conversationDeleteTarget.id,
                        conversationDeleteTarget.title
                      );
                      setConversationDeleteTarget(null);
                    }
                  }}
                >
                  删除
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </SidebarGroup>
      </SidebarContent>
      )}
    </div>
    <ProjectDetailModal
      open={detailOpen}
      onOpenChange={setDetailOpen}
      projectName={project.name}
      projectType={project.type}
      fileCount={fileCount}
      conversationCount={conversationCount}
      artifactCount={artifactCount}
    />
    </SidebarProvider>
  );
}
