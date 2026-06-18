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
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { SelectMenu } from "@/components/ui/select-menu";
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
import { FILE_CATEGORIES, type FileCategory } from "@/lib/file-categories";
import {
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
  onFileUploaded: () => void;
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
  onFileUploaded,
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
    <SidebarProvider defaultOpen className="h-full min-h-0 w-full">
    <div className={cn("flex h-full flex-col overflow-hidden bg-sidebar text-sidebar-foreground backdrop-blur-[var(--glass-blur)]", className)}>
      <SidebarHeader className="grid shrink-0 grid-cols-2 gap-2 p-3">
        <Button asChild variant="outline" size="md" className="w-full">
          <Link href="/projects">
            <NavArrowLeft data-icon="inline-start" strokeWidth={2} />
            项目空间
          </Link>
        </Button>
        <Button asChild variant="primary" size="md" className="w-full">
          <Link href="/projects/new">
            <Plus data-icon="inline-start" strokeWidth={2} />
            新建项目
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
        <div className="mt-3 grid grid-cols-2 gap-1.5">
          <Badge variant="outline" className="h-auto justify-start rounded-[var(--radius-md)] px-2 py-1.5">
            <span className="font-mono text-[11px] text-foreground">{files.length}</span>
            <span className="text-[10px] text-muted-foreground">资料</span>
          </Badge>
          <Badge variant="outline" className="h-auto justify-start rounded-[var(--radius-md)] px-2 py-1.5">
            <span className="font-mono text-[11px] text-foreground">{parsedCount}</span>
            <span className="text-[10px] text-muted-foreground">可检索</span>
          </Badge>
        </div>
      </SidebarGroup>

      {/* 文件区域 */}
      <SidebarContent className="px-3 pb-3">
        <SidebarGroup className="px-0 py-1">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <SidebarGroupLabel className="h-auto px-0 text-xs uppercase tracking-wider">
                资料索引
              </SidebarGroupLabel>
              <p className="mt-0.5 text-[10px] text-[var(--color-text-tertiary)]">
                选择文件会显式参与下一轮回答
              </p>
            </div>
            <Badge variant="outline" className="font-mono text-[10px]">
              {selectedCount}/{files.length}
            </Badge>
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
          <Card size="sm" className="mb-2 bg-card/80 shadow-none">
            <CardContent className="flex flex-col gap-1.5">
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
                <RefreshDouble data-icon="inline-start" strokeWidth={2} />
                重新解析
              </Button>
            </div>
            <div className="grid grid-cols-[1fr_1fr] gap-1.5">
              <SelectMenu
                ariaLabel="筛选"
                placeholder="筛选"
                disabled={files.length === 0}
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
                <MagicWand data-icon="inline-start" strokeWidth={2} />
                重新分类
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <Button
                variant="secondary"
                size="icon-sm"
                onClick={onBatchDelete}
                disabled={selectedCount === 0}
                className="w-full hover:text-destructive"
                aria-label="删除当前上下文文件"
                title="删除"
              >
                <Trash strokeWidth={2} />
              </Button>
              <Button
                variant="secondary"
                size="icon-sm"
                onClick={onBatchReparse}
                disabled={selectedCount === 0}
                className="w-full"
                aria-label="重新解析当前上下文文件"
                title="解析"
              >
                <CubeScan strokeWidth={2} />
              </Button>
              <Button
                variant="secondary"
                size="icon-sm"
                onClick={onBatchDownload}
                disabled={selectedCount === 0}
                className="w-full"
                aria-label="下载当前上下文 Markdown"
                title="下载"
              >
                <Download strokeWidth={2} />
              </Button>
            </div>
            </CardContent>
          </Card>
          <FileUpload
            projectId={project.id}
            onUploaded={onFileUploaded}
          />
          <FileList
            files={files}
            selectedIds={selectedFileIds}
            onToggle={onFileToggle}
            defaultGroupsCollapsed
            className="mt-2"
          />
        </SidebarGroup>

        {/* 对话列表 */}
        <SidebarGroup className="px-0 py-2">
          <SidebarGroupLabel className="text-xs uppercase tracking-wider">
            项目对话
          </SidebarGroupLabel>
          <SidebarGroupAction onClick={onNewConversation} aria-label="新建项目对话">
            <Plus strokeWidth={2} />
          </SidebarGroupAction>
          <SidebarGroupContent>
          {project.conversations && project.conversations.length > 0 ? (
            <SidebarMenu>
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
                  <SidebarMenuAction
                    type="button"
                    showOnHover
                    onClick={(event) => {
                      event.stopPropagation();
                      onConversationDelete(conv.id, conv.title);
                    }}
                    className="hover:text-destructive"
                    aria-label={`删除项目对话 ${conv.title}`}
                    title="删除"
                  >
                    <Trash strokeWidth={2} />
                  </SidebarMenuAction>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          ) : (
            <p className="text-xs text-[var(--color-text-tertiary)] py-2">
              暂无对话
            </p>
          )}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </div>
    </SidebarProvider>
  );
}
