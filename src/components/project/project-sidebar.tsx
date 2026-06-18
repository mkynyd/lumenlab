"use client";

import type { ComponentProps, ReactNode } from "react";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
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
  Plus,
  RefreshDouble,
  Trash,
  ChatLines,
} from "iconoir-react";
import { useProjectFiles } from "@/lib/hooks/use-project-files";
import { LoadingIndicator } from "@/components/workbench/loading-indicator";
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
  onFileAction: (action: "delete" | "reparse" | "download", fileId: string) => void;
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
          className={cn("size-8 rounded-[var(--radius-sm)] border-0", className)}
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
  const parsingCount = files.filter((file) => file.status === "parsing").length;
  const enhancingCount = files.filter((file) => file.enhancementStatus === "enhancing").length;
  const categorizableCount = files.filter((file) =>
    ["parsed", "partial"].includes(file.status)
  ).length;
  const selectedCount = selectedFileIds.size;
  const allSelected = files.length > 0 && selectedCount === files.length;

  return (
    <SidebarProvider defaultOpen className="h-full min-h-0 w-full">
    <div className={cn("flex h-full flex-col overflow-hidden bg-sidebar text-sidebar-foreground backdrop-blur-[var(--glass-blur)]", className)}>
      <SidebarHeader className="grid shrink-0 grid-cols-2 gap-2 p-3">
        <Button asChild variant="outline" size="md" className="w-full">
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
          <div className="mb-2 flex items-center justify-between">
            <div>
              <SidebarGroupLabel className="h-auto px-0 text-xs uppercase tracking-wider">
                资料索引
              </SidebarGroupLabel>
              <p className="mt-0.5 text-[10px] text-[var(--color-text-tertiary)]">
                选择文件会显式参与下一轮回答
              </p>
            </div>
            <span className="font-mono text-[10px] text-[var(--color-text-tertiary)]">
              {selectedCount}/{files.length}
            </span>
          </div>
          {(parsingCount > 0 || enhancingCount > 0) && (
            <div className="mb-2 rounded-[var(--radius-lg)] border border-[var(--color-info-muted)] bg-[var(--color-info-muted)] px-2 py-1.5">
              <LoadingIndicator
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
          <TooltipProvider>
            <ButtonGroup className="mb-2 grid w-fit grid-cols-4 gap-1 [&>*]:rounded-[var(--radius-sm)]! [&>*]:border-0!">
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
              <ToolbarButton
                label="删除当前上下文"
                onClick={onBatchDelete}
                disabled={selectedCount === 0}
                className="hover:text-destructive"
              >
                <Trash strokeWidth={2} />
              </ToolbarButton>
              <ToolbarButton
                label="重新解析"
                onClick={onBatchReparseFailed}
                disabled={failedCount === 0}
              >
                <RefreshDouble strokeWidth={2} />
              </ToolbarButton>
              <ToolbarButton
                label="重新分类"
                onClick={onBatchAutoCategorize}
                disabled={categorizableCount === 0}
              >
                <MagicWand strokeWidth={2} />
              </ToolbarButton>
              <FileUpload
                projectId={project.id}
                onUploaded={onFileUploaded}
                triggerClassName="size-8 rounded-[var(--radius-sm)] border-0"
              />
              <ToolbarButton
                label="解析当前上下文"
                onClick={onBatchReparse}
                disabled={selectedCount === 0}
              >
                <CubeScan strokeWidth={2} />
              </ToolbarButton>
              <ToolbarButton
                label="下载当前上下文"
                onClick={onBatchDownload}
                disabled={selectedCount === 0}
              >
                <Download strokeWidth={2} />
              </ToolbarButton>
            </ButtonGroup>
          </TooltipProvider>
          <ScrollArea className="max-h-[42vh] min-h-0">
            <FileList
              files={files}
              selectedIds={selectedFileIds}
              onToggle={onFileToggle}
              onFileAction={(action, file) => onFileAction(action, file.id)}
              defaultGroupsCollapsed
              className="pr-3"
            />
          </ScrollArea>
        </SidebarGroup>

        {/* 对话列表 */}
        <SidebarGroup className="min-h-0 shrink px-0 py-2">
          <SidebarGroupLabel className="text-xs uppercase tracking-wider">
            项目对话
          </SidebarGroupLabel>
          <SidebarGroupAction onClick={onNewConversation} aria-label="新建项目对话">
            <Plus strokeWidth={2} />
          </SidebarGroupAction>
          <SidebarGroupContent>
          <ScrollArea className="max-h-32">
            {project.conversations && project.conversations.length > 0 ? (
              <SidebarMenu className="pr-3">
                {project.conversations.map((conv) => (
                  <SidebarMenuItem
                    key={conv.id}
                  >
                    <SidebarMenuButton
                      type="button"
                      onClick={() => onConversationSelect(conv.id)}
                      isActive={activeConversationId === conv.id}
                      size="sm"
                    >
                      <ChatLines strokeWidth={2} />
                      <span>{conv.title}</span>
                    </SidebarMenuButton>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <SidebarMenuAction
                          type="button"
                          showOnHover
                          onClick={(event) => event.stopPropagation()}
                          className="hover:text-destructive"
                          aria-label={`删除项目对话 ${conv.title}`}
                        >
                          <Trash strokeWidth={2} />
                        </SidebarMenuAction>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>删除项目对话</AlertDialogTitle>
                          <AlertDialogDescription>
                            确定要删除「{conv.title}」吗？这条对话记录将无法恢复。
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>取消</AlertDialogCancel>
                          <AlertDialogAction
                            variant="destructive"
                            onClick={() => onConversationDelete(conv.id, conv.title)}
                          >
                            删除
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            ) : (
              <p className="py-2 text-xs text-[var(--color-text-tertiary)]">
                暂无对话
              </p>
            )}
          </ScrollArea>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </div>
    </SidebarProvider>
  );
}
