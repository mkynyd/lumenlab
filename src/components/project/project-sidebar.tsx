"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { FileUpload } from "@/components/project/file-upload";
import { FileList, type ProjectFile } from "@/components/project/file-list";
import { Button } from "@/components/ui/button";
import {
  FolderOpen,
  MessageSquare,
  Plus,
  Settings,
} from "lucide-react";

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
  onFileToggle: (id: string) => void;
  onFileDelete: (id: string) => void;
  onFileUploaded: () => void;
  onNewConversation: () => void;
  onConversationSelect: (id: string) => void;
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
  onFileDelete,
  onFileUploaded,
  onNewConversation,
  onConversationSelect,
  activeConversationId,
  className,
}: ProjectSidebarProps) {
  return (
    <div className={cn("flex h-full flex-col overflow-hidden", className)}>
      {/* 项目信息 */}
      <div className="p-4 border-b border-[var(--color-border)] shrink-0">
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
      </div>

      {/* 文件区域 */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-3 py-2 border-b border-[var(--color-border-light)]">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider">
              资料文件
            </span>
            <span className="text-[10px] font-mono text-[var(--color-text-tertiary)]">
              {selectedFileIds.size}/{project.files?.length || 0}
            </span>
          </div>
          <FileUpload
            projectId={project.id}
            onUploaded={onFileUploaded}
          />
          <FileList
            files={project.files || []}
            selectedIds={selectedFileIds}
            onToggle={onFileToggle}
            onDelete={onFileDelete}
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
                <button
                  key={conv.id}
                  type="button"
                  onClick={() => onConversationSelect(conv.id)}
                  className={cn(
                    "flex w-full items-center gap-2 px-2 h-8 rounded-[var(--radius-md)] text-left",
                    "text-xs transition-colors duration-100",
                    "hover:bg-[var(--color-surface-hover)]",
                    activeConversationId === conv.id
                      ? "bg-[var(--color-accent-muted)] text-[var(--color-accent)]"
                      : "text-[var(--color-text-secondary)]"
                  )}
                >
                  <MessageSquare size={12} strokeWidth={2} className="shrink-0 opacity-70" />
                  <span className="truncate flex-1">{conv.title}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-[var(--color-text-tertiary)] py-2">
              暂无对话
            </p>
          )}
        </div>
      </div>

      {/* 底部链接 */}
      <div className="px-4 py-2 border-t border-[var(--color-border)] shrink-0">
        <Link
          href="/projects"
          className="flex items-center gap-1.5 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-colors"
        >
          <Settings size={12} strokeWidth={2} />
          所有项目
        </Link>
      </div>
    </div>
  );
}
