"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Plus, FolderOpen, Trash2, MessageSquare, FileText } from "lucide-react";
import { useDeleteProject, useProjects } from "@/lib/hooks/use-projects";

const TYPE_LABELS: Record<string, string> = {
  experiment: "实验工作台",
  review: "资料复习",
  coding: "代码项目",
  general: "通用项目",
};

export default function ProjectsPage() {
  const projectsQuery = useProjects();
  const deleteProjectMutation = useDeleteProject();
  const projects = projectsQuery.data || [];
  const isLoading = projectsQuery.isPending;

  async function deleteProject(id: string, name: string) {
    if (!confirm(`确定要删除项目「${name}」吗？相关文件和数据将被一并删除。`)) return;
    await deleteProjectMutation.mutateAsync(id);
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* 页头 */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">
              项目空间
            </h1>
            <p className="text-sm text-[var(--color-text-secondary)] mt-1">
              管理你的实验工作台、资料复习和代码项目
            </p>
          </div>
          <Link href="/projects/new">
            <Button variant="primary" size="md">
              <Plus size={16} strokeWidth={2} />
              新建项目
            </Button>
          </Link>
        </div>

        {/* 项目列表 */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-32 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] animate-pulse"
              />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="flex items-center justify-center w-12 h-12 mb-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
              <FolderOpen size={24} strokeWidth={1.5} className="text-[var(--color-text-tertiary)]" />
            </div>
            <h2 className="text-base font-medium text-[var(--color-text-primary)] mb-1">
              暂无项目
            </h2>
            <p className="text-sm text-[var(--color-text-secondary)] max-w-sm mb-4">
              创建一个项目空间，上传实验截图、代码、数据表、课件或试卷，开始构建上下文。
            </p>
            <Link href="/projects/new">
              <Button variant="primary" size="md">
                <Plus size={16} strokeWidth={2} />
                创建第一个项目
              </Button>
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {projects.map((project) => (
              <div
                key={project.id}
                className={cn(
                  "group relative p-5 rounded-[var(--radius-lg)]",
                  "border border-[var(--color-border)] bg-[var(--color-surface)]",
                  "hover:border-[var(--color-accent)] transition-colors duration-150"
                )}
              >
                <Link
                  href={`/projects/${project.id}`}
                  className="block focus:outline-none"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold text-[var(--color-text-primary)] truncate">
                        {project.name}
                      </h3>
                      <span className="text-[10px] font-mono text-[var(--color-text-tertiary)] uppercase tracking-wider">
                        {TYPE_LABELS[project.type] || project.type}
                      </span>
                    </div>
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        deleteProject(project.id, project.name);
                      }}
                      className={cn(
                        "shrink-0 p-1 rounded-[2px]",
                        "opacity-0 group-hover:opacity-100",
                        "text-[var(--color-text-tertiary)] hover:text-[var(--color-error)] hover:bg-[var(--color-error-muted)]",
                        "transition-all duration-100"
                      )}
                      aria-label={`删除 ${project.name}`}
                    >
                      <Trash2 size={14} strokeWidth={2} />
                    </button>
                  </div>
                  {project.description && (
                    <p className="text-xs text-[var(--color-text-secondary)] line-clamp-2 mb-3">
                      {project.description}
                    </p>
                  )}
                  <div className="flex items-center gap-3 text-[11px] font-mono text-[var(--color-text-tertiary)]">
                    <span className="flex items-center gap-1">
                      <MessageSquare size={12} strokeWidth={2} />
                      {project._count.conversations} 对话
                    </span>
                    <span className="flex items-center gap-1">
                      <FileText size={12} strokeWidth={2} />
                      {project._count.files} 文件
                    </span>
                    <span className="ml-auto">
                      {new Date(project.updatedAt).toLocaleDateString("zh-CN")}
                    </span>
                  </div>
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
