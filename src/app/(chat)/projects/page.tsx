"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ChatLines, Folder, Page, Plus, Trash } from "iconoir-react";
import { useDeleteProject, useProjects } from "@/lib/hooks/use-projects";
import { SpotlightCard } from "@/components/workbench/spotlight-card";
import { AmbientField } from "@/components/workbench/ambient-field";
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
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

const TYPE_LABELS: Record<string, string> = {
  experiment: "实验工作台",
  review: "资料复习",
  coding: "代码项目",
  general: "通用项目",
};

export default function ProjectsPage() {
  const router = useRouter();
  const projectsQuery = useProjects();
  const deleteProjectMutation = useDeleteProject();
  const projects = projectsQuery.data || [];
  const isLoading = projectsQuery.isPending;
  const [contextDeleteTarget, setContextDeleteTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);

  async function deleteProject(id: string) {
    await deleteProjectMutation.mutateAsync(id);
  }

  return (
    <div className="project-workbench relative h-full overflow-y-auto">
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
	            <Button
	              variant="primary"
	              size="md"
	              className="bg-[var(--color-project-action)] text-[var(--color-project-action-contrast)] hover:bg-[var(--color-project-action-hover)] focus-visible:bg-[var(--color-project-action-hover)]"
	            >
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
	                className="h-36 animate-pulse rounded-[var(--radius-xl)] bg-[var(--color-project-surface)]"
              />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-[var(--radius-xl)] bg-[var(--color-project-control)]">
		              <Folder width={24} height={24} strokeWidth={1.5} className="text-[var(--color-text-tertiary)]" />
            </div>
            <h2 className="text-base font-medium text-[var(--color-text-primary)] mb-1">
              暂无项目
            </h2>
            <Link href="/projects/new">
	              <Button
	                variant="primary"
	                size="md"
	                className="bg-[var(--color-project-action)] text-[var(--color-project-action-contrast)] hover:bg-[var(--color-project-action-hover)] focus-visible:bg-[var(--color-project-action-hover)]"
	              >
	                <Plus width={16} height={16} strokeWidth={2} />
	                创建第一个项目
              </Button>
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {projects.map((project) => (
              <ContextMenu key={project.id}>
                <ContextMenuTrigger asChild>
                  <SpotlightCard
                    className={cn(
                      "group relative p-5"
                    )}
                  >
	                  <div className="flex items-start justify-between mb-3">
	                    <Link
	                      href={`/projects/${project.id}`}
	                      className="flex min-h-11 min-w-0 flex-1 flex-col justify-center focus-visible:outline-none focus-visible:bg-[var(--color-project-surface-hover)] rounded-[var(--radius-sm)]"
	                    >
	                      <h2 className="truncate text-base font-semibold text-[var(--color-text-primary)]">
	                        {project.name}
	                      </h2>
	                      <span className="text-[11px] text-[var(--color-text-tertiary)]">
	                        {TYPE_LABELS[project.type] || project.type}
	                      </span>
	                    </Link>
	                    <AlertDialog>
	                      <AlertDialogTrigger asChild>
	                        <Button
	                          type="button"
	                          variant="ghost"
	                          size="icon-sm"
	                          className={cn(
	                            "size-11 shrink-0 rounded-[var(--radius-sm)] sm:size-7",
	                            "opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 focus-visible:opacity-100",
	                            "text-[var(--color-text-tertiary)] hover:text-[var(--color-error)] hover:bg-[var(--color-error-muted)]",
	                            "transition-all duration-100"
	                          )}
	                          aria-label={`删除 ${project.name}`}
	                        >
		                          <Trash width={14} height={14} strokeWidth={2} />
	                        </Button>
	                      </AlertDialogTrigger>
	                      <AlertDialogContent>
	                        <AlertDialogHeader>
	                          <AlertDialogTitle>删除项目</AlertDialogTitle>
	                          <AlertDialogDescription>
	                            确定要删除「{project.name}」吗？相关文件和对话将被一并删除。
	                          </AlertDialogDescription>
	                        </AlertDialogHeader>
	                        <AlertDialogFooter>
	                          <AlertDialogCancel>取消</AlertDialogCancel>
	                          <AlertDialogAction
	                            variant="destructive"
                          onClick={() => void deleteProject(project.id)}
	                          >
	                            删除
	                          </AlertDialogAction>
	                        </AlertDialogFooter>
	                      </AlertDialogContent>
	                    </AlertDialog>
	                  </div>
	                  <Link
	                    href={`/projects/${project.id}`}
	                    className="block min-h-11 focus-visible:outline-none focus-visible:bg-[var(--color-project-surface-hover)] rounded-[var(--radius-sm)]"
	                  >
	                    {project.description && (
	                      <p className="mb-4 line-clamp-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">
	                        {project.description}
	                      </p>
	                    )}
	                    <div className="flex items-center gap-2 text-[11px] font-mono text-[var(--color-text-tertiary)]">
	                      <span className="flex items-center gap-1 rounded-[var(--radius-md)] bg-[var(--color-project-control)] px-2 py-1">
			                      <ChatLines width={12} height={12} strokeWidth={2} />
	                        {project._count.conversations} 对话
	                      </span>
	                      <span className="flex items-center gap-1 rounded-[var(--radius-md)] bg-[var(--color-project-control)] px-2 py-1">
			                      <Page width={12} height={12} strokeWidth={2} />
	                        {project._count.files} 文件
	                      </span>
	                      <span className="ml-auto">
	                        {new Date(project.updatedAt).toLocaleDateString("zh-CN")}
	                      </span>
	                    </div>
	                  </Link>
                  </SpotlightCard>
                </ContextMenuTrigger>
                <ContextMenuContent className="min-w-36">
                  <ContextMenuItem
                    onSelect={() => router.push(`/projects/${project.id}`)}
                  >
                    <Folder strokeWidth={2} />
                    打开项目
                  </ContextMenuItem>
                  <ContextMenuItem
                    variant="destructive"
                    onSelect={() => setContextDeleteTarget(project)}
                  >
                    <Trash strokeWidth={2} />
                    删除
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))}
          </div>
        )}
      </div>
      <AlertDialog
        open={contextDeleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setContextDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除项目</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除「{contextDeleteTarget?.name}」吗？相关文件和对话将被一并删除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (contextDeleteTarget) {
                  void deleteProject(contextDeleteTarget.id);
                  setContextDeleteTarget(null);
                }
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
