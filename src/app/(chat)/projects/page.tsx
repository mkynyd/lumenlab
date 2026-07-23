"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  ChatLines,
  Folder,
  MoreHoriz,
  Page,
  Plus,
  Trash,
} from "iconoir-react";
import { useDeleteProject, useProjects } from "@/lib/hooks/use-projects";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
    <div className="project-workbench h-full overflow-y-auto bg-[var(--color-bg)]">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-[-0.02em] text-[var(--color-text-primary)]">
              项目空间
            </h1>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
              在资料与对话之间继续你的工作
            </p>
          </div>
          <Link href="/projects/new">
            <Button
              variant="primary"
              size="sm"
              className="bg-[var(--color-project-action)] text-[var(--color-project-action-contrast)] hover:bg-[var(--color-project-action-hover)] focus-visible:bg-[var(--color-project-action-hover)]"
            >
              <Plus width={16} height={16} strokeWidth={2} />
              新建项目
            </Button>
          </Link>
        </div>

        {isLoading ? (
          <div className="space-y-1" aria-label="正在加载项目">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-20 animate-pulse rounded-[var(--radius-md)] bg-[var(--color-project-control)]"
              />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <Folder
              width={26}
              height={26}
              strokeWidth={1.5}
              className="mb-4 text-[var(--color-text-tertiary)]"
            />
            <h2 className="mb-1 text-base font-medium text-[var(--color-text-primary)]">
              暂无项目
            </h2>
            <p className="mb-5 text-sm text-[var(--color-text-tertiary)]">
              创建一个项目，把资料、对话与成果放在一起。
            </p>
            <Link href="/projects/new">
              <Button
                variant="primary"
                size="sm"
                className="bg-[var(--color-project-action)] text-[var(--color-project-action-contrast)] hover:bg-[var(--color-project-action-hover)] focus-visible:bg-[var(--color-project-action-hover)]"
              >
                <Plus width={16} height={16} strokeWidth={2} />
                创建项目
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-1" role="list">
            {projects.map((project) => (
              <ContextMenu key={project.id}>
                <ContextMenuTrigger asChild>
                  <div
                    role="listitem"
                    className="group relative rounded-[var(--radius-md)] transition-colors duration-150 hover:bg-[var(--color-project-surface-hover)] focus-within:bg-[var(--color-project-surface-hover)]"
                  >
                    <Link
                      href={`/projects/${project.id}`}
                      className="flex min-h-20 items-center gap-3 rounded-[var(--radius-md)] px-3 py-3 pr-12 focus-visible:bg-[var(--color-project-surface-hover)]"
                    >
                      <Folder
                        width={20}
                        height={20}
                        strokeWidth={1.7}
                        className="shrink-0 text-[var(--color-text-tertiary)]"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-baseline gap-2">
                          <h2 className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
                            {project.name}
                          </h2>
                          <span className="shrink-0 text-[11px] text-[var(--color-text-tertiary)]">
                            {TYPE_LABELS[project.type] || project.type}
                          </span>
                        </div>
                        {project.description && (
                          <p className="mt-0.5 line-clamp-1 text-xs leading-relaxed text-[var(--color-text-secondary)]">
                            {project.description}
                          </p>
                        )}
                        <div className="mt-1.5 flex items-center gap-3 text-[11px] text-[var(--color-text-tertiary)]">
                          <span className="inline-flex items-center gap-1">
                            <ChatLines width={12} height={12} strokeWidth={1.8} />
                            {project._count.conversations} 对话
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Page width={12} height={12} strokeWidth={1.8} />
                            {project._count.files} 文件
                          </span>
                          <span className="ml-auto hidden sm:inline">
                            {new Date(project.updatedAt).toLocaleDateString(
                              "zh-CN"
                            )}
                          </span>
                        </div>
                      </div>
                    </Link>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="absolute right-2 top-1/2 z-10 -translate-y-1/2 text-[var(--color-text-tertiary)] opacity-100 hover:bg-[var(--color-interaction-hover)] hover:text-[var(--color-text-primary)] sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                          aria-label={`${project.name} 的更多操作`}
                        >
                          <MoreHoriz width={16} height={16} strokeWidth={2} />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-32">
                        <DropdownMenuItem
                          onSelect={() =>
                            router.push(`/projects/${project.id}`)
                          }
                        >
                          <Folder strokeWidth={2} />
                          打开
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => setContextDeleteTarget(project)}
                        >
                          <Trash strokeWidth={2} />
                          删除
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent className="min-w-36">
                  <ContextMenuItem
                    onSelect={() => router.push(`/projects/${project.id}`)}
                  >
                    <Folder strokeWidth={2} />
                    打开
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
