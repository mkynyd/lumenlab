"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ChatLines, Folder, Page, Plus, Trash } from "iconoir-react";
import { useDeleteProject, useProjects } from "@/lib/hooks/use-projects";
import { SpotlightCard } from "@/components/workbench/spotlight-card";
import { AmbientField } from "@/components/workbench/ambient-field";

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
    <div className="relative h-full overflow-y-auto">
      <AmbientField density="wide" className="opacity-55" />
      <div className="relative mx-auto max-w-5xl px-4 py-8">
        {/* 页头 */}
        <div className="mb-8 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">
              项目空间
            </h1>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
              管理你的实验工作台、资料复习和代码项目
            </p>
          </div>
          <Link href="/projects/new">
	            <Button variant="primary" size="md">
	              <Plus width={16} height={16} strokeWidth={2} />
	              新建项目
	            </Button>
          </Link>
        </div>

        {/* 项目列表 */}
        {isLoading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-36 animate-pulse rounded-[var(--radius-xl)] border border-[var(--color-border-light)] bg-[var(--color-surface)]"
              />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-[var(--radius-xl)] border border-[var(--color-border-light)] bg-[var(--color-surface)] shadow-[var(--shadow-panel)]">
	              <Folder width={24} height={24} strokeWidth={1.5} className="text-[var(--color-text-tertiary)]" />
            </div>
            <h2 className="text-base font-medium text-[var(--color-text-primary)] mb-1">
              暂无项目
            </h2>
            <p className="text-sm text-[var(--color-text-secondary)] max-w-sm mb-4">
              创建一个项目空间，上传实验截图、代码、数据表、课件或试卷，开始构建上下文。
            </p>
            <Link href="/projects/new">
	              <Button variant="primary" size="md">
	                <Plus width={16} height={16} strokeWidth={2} />
	                创建第一个项目
              </Button>
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {projects.map((project) => (
              <SpotlightCard
                key={project.id}
                className={cn(
                  "group relative p-5"
                )}
              >
                <Link
                  href={`/projects/${project.id}`}
                  className="block focus:outline-none"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-base font-semibold text-[var(--color-text-primary)]">
                        {project.name}
                      </h3>
                      <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-text-tertiary)]">
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
                        "shrink-0 rounded-[var(--radius-sm)] border border-transparent p-1.5",
                        "opacity-0 group-hover:opacity-100",
                        "text-[var(--color-text-tertiary)] hover:text-[var(--color-error)] hover:bg-[var(--color-error-muted)]",
                        "transition-all duration-100"
                      )}
                      aria-label={`删除 ${project.name}`}
                    >
	                      <Trash width={14} height={14} strokeWidth={2} />
                    </button>
                  </div>
                  {project.description && (
                    <p className="mb-4 line-clamp-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">
                      {project.description}
                    </p>
                  )}
                  <div className="flex items-center gap-2 text-[11px] font-mono text-[var(--color-text-tertiary)]">
                    <span className="flex items-center gap-1 rounded-[var(--radius-md)] bg-[var(--color-panel-muted)] px-2 py-1">
	                      <ChatLines width={12} height={12} strokeWidth={2} />
                      {project._count.conversations} 对话
                    </span>
                    <span className="flex items-center gap-1 rounded-[var(--radius-md)] bg-[var(--color-panel-muted)] px-2 py-1">
	                      <Page width={12} height={12} strokeWidth={2} />
                      {project._count.files} 文件
                    </span>
                    <span className="ml-auto">
                      {new Date(project.updatedAt).toLocaleDateString("zh-CN")}
                    </span>
                  </div>
                </Link>
              </SpotlightCard>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
