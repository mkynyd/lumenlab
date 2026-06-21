"use client";

import { useState, type ComponentProps, type ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { FileUpload } from "@/components/project/file-upload";
import {
  FileList,
  type FileSelectionIntent,
  type ProjectFile,
} from "@/components/project/file-list";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
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
  CubeScan,
  Download,
  Folder,
  MagicWand,
  NavArrowLeft,
  NavArrowDown,
  NavArrowRight,
  Plus,
  RefreshDouble,
  Trash,
  ChatLines,
  MoreHoriz,
} from "iconoir-react";
import { useProjectFiles } from "@/lib/hooks/use-project-files";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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
  onFileUploaded: () => void;
  onBatchDelete: () => void;
  onBatchReparse: () => void;
  onBatchAutoCategorize: () => void;
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

function ToolbarButton({
  label,
  children,
  className,
  ...props
}: ComponentProps<typeof Button> & {
  label: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          size="icon-sm"
          className={cn(
            "h-8 w-full rounded-[var(--radius-sm)] border-0",
            "bg-[var(--color-surface)] text-[var(--color-text-secondary)]",
            "hover:bg-[var(--color-project-hover)] hover:text-[var(--color-text-primary)]",
            className
          )}
          aria-label={label}
          {...props}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

export function ProjectSidebar({
  project,
  selectedFileIds,
  onFileToggle,
  onSelectAllFiles,
  onClearFileSelection,
  onFileUploaded,
  onBatchDelete,
  onBatchReparse,
  onBatchAutoCategorize,
  onBatchReparseFailed,
  onBatchDownload,
  onFileAction,
  onNewConversation,
  onConversationSelect,
  onConversationDelete,
  activeConversationId,
  className,
}: ProjectSidebarProps) {
  const filesQuery = useProjectFiles(project.id, project.files || []);
  const files = filesQuery.data || project.files || [];
  const failedCount = files.filter((file) => file.status === "failed").length;
  const categorizableCount = files.filter((file) =>
    ["parsed", "partial"].includes(file.status)
  ).length;
  const selectedCount = selectedFileIds.size;
  const allSelected = files.length > 0 && selectedCount === files.length;
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [conversationsOpen, setConversationsOpen] = useState(true);
  const [conversationDeleteTarget, setConversationDeleteTarget] = useState<{
    id: string;
    title: string;
  } | null>(null);

  return (
    <SidebarProvider defaultOpen className="h-full min-h-0 w-full overflow-hidden">
    <div className={cn("flex h-full w-full min-w-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground backdrop-blur-[var(--glass-blur)]", className)}>
      <SidebarHeader className="grid shrink-0 grid-cols-2 gap-2 p-3">
        <Button
          asChild
          variant="outline"
          size="md"
          className="w-full hover:bg-[var(--color-project-hover)] hover:text-[var(--color-text-primary)]"
        >
          <Link href="/projects" className="min-w-0">
            <NavArrowLeft data-icon="inline-start" strokeWidth={2} />
            <span className="truncate">项目空间</span>
          </Link>
        </Button>
        <Button asChild variant="primary" size="md" className="w-full">
          <Link href="/projects/new" className="min-w-0">
            <Plus data-icon="inline-start" strokeWidth={2} />
            <span className="truncate">新建项目</span>
          </Link>
        </Button>
      </SidebarHeader>

      {/* 项目信息 */}
      <SidebarGroup className="shrink-0 px-3 py-2">
        <div className="mb-1 flex items-center gap-2">
          <Folder width={16} height={16} strokeWidth={2} className="text-[var(--color-text-tertiary)]" />
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
      </SidebarGroup>

      {/* 文件区域 */}
      <SidebarContent className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 pb-3">
        <SidebarGroup className="flex min-h-0 shrink-0 flex-col px-0 py-1">
          <TooltipProvider delayDuration={500}>
            <ButtonGroup className="mb-2 grid w-full grid-cols-4 gap-1 [&>*]:rounded-[var(--radius-sm)]! [&>*]:border-0!">
              <ToolbarButton
                label={allSelected ? "取消全选" : "全选"}
                onClick={allSelected ? onClearFileSelection : onSelectAllFiles}
                disabled={files.length === 0}
                variant="secondary"
                className={cn(
                  allSelected &&
                    "bg-[var(--color-interaction-active)] text-[var(--color-text-primary)] hover:bg-[var(--color-interaction-active)]"
                )}
              >
                {allSelected ? (
                  <CheckCircleSolid strokeWidth={2} />
                ) : (
                  <CheckCircle strokeWidth={2} />
                )}
              </ToolbarButton>
              <FileUpload
                projectId={project.id}
                onUploaded={onFileUploaded}
                triggerClassName="h-8 w-full rounded-[var(--radius-sm)] border-0 bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-project-hover)] hover:text-[var(--color-text-primary)]"
              />
              <ToolbarButton
                label="重新分类"
                onClick={onBatchAutoCategorize}
                disabled={categorizableCount === 0}
              >
                <MagicWand strokeWidth={2} />
              </ToolbarButton>
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="secondary"
                        size="icon-sm"
                        className="h-8 w-full rounded-[var(--radius-sm)] border-0 bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-project-hover)] hover:text-[var(--color-text-primary)]"
                        aria-label="更多资料操作"
                      >
                        <MoreHoriz strokeWidth={2} />
                      </Button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">更多</TooltipContent>
                </Tooltip>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem
                    disabled={failedCount === 0}
                    onSelect={() => onBatchReparseFailed()}
                  >
                    <RefreshDouble strokeWidth={2} />
                    重新解析
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={selectedCount === 0}
                    onSelect={() => onBatchReparse()}
                  >
                    <CubeScan strokeWidth={2} />
                    解析当前上下文
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={selectedCount === 0}
                    onSelect={() => onBatchDownload()}
                  >
                    <Download strokeWidth={2} />
                    下载当前上下文
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={selectedCount === 0}
                    onSelect={() => setBatchDeleteOpen(true)}
                  >
                    <Trash strokeWidth={2} />
                    删除当前上下文
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </ButtonGroup>
          </TooltipProvider>
          <AlertDialog open={batchDeleteOpen} onOpenChange={setBatchDeleteOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>删除当前上下文</AlertDialogTitle>
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
          <ScrollArea className="max-h-[44vh] min-h-0 w-full overflow-x-hidden">
            <FileList
              files={files}
              selectedIds={selectedFileIds}
              onToggle={onFileToggle}
              onFileAction={(action, file) => onFileAction(action, file.id)}
              defaultGroupsCollapsed
              className="w-full overflow-hidden"
            />
          </ScrollArea>
        </SidebarGroup>

        {/* 对话列表 */}
        <SidebarGroup
          className={cn(
            "min-h-0 px-0 py-2",
            conversationsOpen ? "flex flex-1 flex-col" : "shrink-0"
          )}
        >
          <div className="mb-1 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setConversationsOpen((value) => !value)}
              className="flex h-7 min-w-0 flex-1 items-center justify-between rounded-[var(--radius-sm)] px-2 text-[11px] font-medium text-[var(--color-text-tertiary)] hover:bg-[var(--color-project-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:bg-[var(--color-project-hover)] focus-visible:text-[var(--color-text-primary)]"
              aria-expanded={conversationsOpen}
            >
              <span className="inline-flex min-w-0 items-center gap-1">
                {conversationsOpen ? (
                  <NavArrowDown width={12} height={12} />
                ) : (
                  <NavArrowRight width={12} height={12} />
                )}
                <span className="truncate">项目对话</span>
              </span>
              <span className="font-mono">{project.conversations?.length || 0}</span>
            </button>
            <button
              type="button"
              onClick={onNewConversation}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-project-action)] text-[var(--color-project-action-contrast)] hover:bg-[var(--color-project-action-hover)] focus-visible:outline-none focus-visible:bg-[var(--color-project-action-hover)]"
              aria-label="新建项目对话"
            >
              <Plus width={14} height={14} strokeWidth={2} />
            </button>
          </div>
          <SidebarGroupContent
            className={cn("min-h-0", conversationsOpen && "flex-1")}
          >
            {conversationsOpen && (
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
                            "transition-[background-color,color] duration-150 focus-visible:outline-none focus-visible:bg-[var(--color-project-hover)] focus-visible:text-[var(--color-text-primary)]",
                            active
                              ? "bg-[var(--color-interaction-active)] text-[var(--color-text-primary)]"
                              : "text-[var(--color-text-secondary)] hover:bg-[var(--color-project-hover)] hover:text-[var(--color-text-primary)]"
                          )}
                        >
                          <ChatLines width={14} height={14} strokeWidth={2} className="shrink-0 opacity-70" />
                          <span className="min-w-0 flex-1 truncate font-medium">{conv.title}</span>
                        </button>
                      );
                      return (
                        <ContextMenu key={conv.id}>
                          <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
                          <ContextMenuContent className="min-w-36">
                            <ContextMenuItem onSelect={() => onConversationSelect(conv.id)}>
                              <ChatLines strokeWidth={2} />
                              打开对话
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
            )}
          </SidebarGroupContent>
          <AlertDialog
            open={conversationDeleteTarget !== null}
            onOpenChange={(open) => {
              if (!open) setConversationDeleteTarget(null);
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>删除项目对话</AlertDialogTitle>
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
    </div>
    </SidebarProvider>
  );
}
