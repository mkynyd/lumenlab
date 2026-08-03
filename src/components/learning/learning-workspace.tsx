"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { BookOpen, FolderOpen, LayoutDashboard, Plus } from "lucide-react"

import { LearningCalendar } from "@/components/learning/learning-calendar"
import { LearningPageClient } from "@/components/learning/learning-page-client"
import { TodayView } from "@/components/learning/today-view"
import { EmptyState } from "@/components/learning/empty-state"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { LearningLoopRollout } from "@/lib/learning/feature-flags"
import type { LearningDeepLinkStep } from "@/lib/hooks/use-learning-api"
import { useProjects } from "@/lib/hooks/use-projects"
import type { ProjectSummary } from "@/lib/api/types"

const PROJECT_TYPE_LABELS: Record<string, string> = {
  experiment: "实验",
  review: "复习",
  coding: "编程",
  general: "通用",
}

export interface LearningWorkspaceProps {
  initialProjectId?: string | null
  initialGoalId?: string | null
  initialStep?: LearningDeepLinkStep | null
  initialSessionId?: string | null
  rollout?: LearningLoopRollout
}

function ProjectLearningRow({ project }: { project: ProjectSummary }) {
  return (
    <Button
      asChild
      variant="ghost"
      className="h-auto w-full justify-start gap-3 whitespace-normal rounded-xl bg-[var(--color-surface-hover)] px-4 py-3 text-left"
    >
      <Link href={`/learning?project=${encodeURIComponent(project.id)}`}>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-surface)] text-[var(--color-text-secondary)]">
          <FolderOpen aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-[var(--color-text-primary)]">
            {project.name}
          </span>
          <span className="mt-0.5 block text-xs text-[var(--color-text-tertiary)]">
            {PROJECT_TYPE_LABELS[project.type] ?? project.type} · {project._count.files} 份资料
          </span>
        </span>
        <span className="text-xs text-[var(--color-text-secondary)]">设置学习</span>
      </Link>
    </Button>
  )
}

/**
 * First-class learning workspace. Projects remain the ownership/material
 * boundary, while the learner chooses and configures them entirely here.
 */
export function LearningWorkspace({
  initialProjectId = null,
  initialGoalId = null,
  initialStep = null,
  initialSessionId = null,
  rollout = "preview",
}: LearningWorkspaceProps) {
  const router = useRouter()
  const projectsQuery = useProjects()
  const projects = projectsQuery.data ?? []
  const selectedProject = initialProjectId
    ? projects.find((project) => project.id === initialProjectId) ?? null
    : null
  const selectedProjectMissing =
    Boolean(initialProjectId) && !projectsQuery.isPending && !selectedProject

  function selectProject(projectId: string) {
    router.push(`/learning?project=${encodeURIComponent(projectId)}`)
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6 md:py-8">
        <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[var(--color-text-secondary)]">
              <BookOpen aria-hidden="true" className="size-5" />
              <span className="text-xs font-medium uppercase tracking-[0.12em]">
                Learning
              </span>
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-[var(--color-text-primary)] md:text-3xl">
              学习中心
            </h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--color-text-secondary)]">
              今日任务、复习日历和项目学习集中在一个工作区。选择已有项目后即可设置目标与学习范围。
            </p>
            {rollout === "preview" ? (
              <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">
                学习功能预览版
              </p>
            ) : null}
          </div>

          <div className="flex w-full items-center gap-2 sm:w-auto">
            {initialProjectId ? (
              <Button asChild variant="ghost" className="shrink-0">
                <Link href="/learning">
                  <LayoutDashboard data-icon="inline-start" aria-hidden="true" />
                  总览
                </Link>
              </Button>
            ) : null}
            <Select
              value={selectedProject?.id}
              onValueChange={selectProject}
              disabled={projectsQuery.isPending || projects.length === 0}
            >
              <SelectTrigger
                aria-label="选择学习项目"
                className="min-w-0 flex-1 sm:w-64 sm:flex-none"
              >
                <SelectValue
                  placeholder={
                    projectsQuery.isPending ? "正在加载项目…" : "选择已有项目"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>学习项目</SelectLabel>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </header>

        <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
          <div className="min-w-0">
            {projectsQuery.isError ? (
              <EmptyState
                title="暂时无法读取项目"
                description="请检查网络后重试。"
                action={
                  <Button type="button" variant="secondary" onClick={() => projectsQuery.refetch()}>
                    重试
                  </Button>
                }
              />
            ) : selectedProjectMissing ? (
              <EmptyState
                title="没有找到这个学习项目"
                description="项目可能已删除，或当前账户没有访问权限。"
                action={
                  <Button asChild>
                    <Link href="/learning">返回学习总览</Link>
                  </Button>
                }
              />
            ) : initialProjectId && projectsQuery.isPending ? (
              <p role="status" className="py-12 text-center text-sm text-[var(--color-text-secondary)]">
                正在打开学习项目…
              </p>
            ) : selectedProject ? (
              <section aria-labelledby="selected-learning-project">
                <div className="mb-5 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-[var(--color-text-tertiary)]">当前学习项目</p>
                    <h2
                      id="selected-learning-project"
                      className="mt-1 truncate text-lg font-semibold text-[var(--color-text-primary)]"
                    >
                      {selectedProject.name}
                    </h2>
                    <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                      {selectedProject._count.files} 份资料 · {PROJECT_TYPE_LABELS[selectedProject.type] ?? selectedProject.type}
                    </p>
                  </div>
                  <Button asChild variant="secondary" className="shrink-0">
                    <Link href={`/projects/${encodeURIComponent(selectedProject.id)}`}>
                      查看资料
                    </Link>
                  </Button>
                </div>
                <LearningPageClient
                  key={`${selectedProject.id}:${initialGoalId ?? "active"}:${initialStep ?? "progress"}:${initialSessionId ?? "browse"}`}
                  projectId={selectedProject.id}
                  projectName={selectedProject.name}
                  initialGoalId={initialGoalId}
                  initialStep={initialStep}
                  initialSessionId={initialSessionId}
                  rollout={rollout}
                  embedded
                />
              </section>
            ) : (
              <div className="flex flex-col gap-8">
                <section aria-labelledby="today-learning-title">
                  <div className="mb-4">
                    <p className="text-xs text-[var(--color-text-tertiary)]">今日节奏</p>
                    <h2
                      id="today-learning-title"
                      className="mt-1 text-lg font-semibold text-[var(--color-text-primary)]"
                    >
                      下一步学习
                    </h2>
                  </div>
                  <TodayView />
                </section>

                <section id="learning-projects" aria-labelledby="project-learning-title">
                  <div className="mb-3 flex items-end justify-between gap-3">
                    <div>
                      <p className="text-xs text-[var(--color-text-tertiary)]">学习资料</p>
                      <h2
                        id="project-learning-title"
                        className="mt-1 text-lg font-semibold text-[var(--color-text-primary)]"
                      >
                        从已有项目开始
                      </h2>
                    </div>
                    <Button asChild variant="secondary">
                      <Link href="/projects/new">
                        <Plus data-icon="inline-start" aria-hidden="true" />
                        新建项目
                      </Link>
                    </Button>
                  </div>

                  {projectsQuery.isPending ? (
                    <p role="status" className="py-8 text-sm text-[var(--color-text-secondary)]">
                      正在加载项目…
                    </p>
                  ) : projects.length > 0 ? (
                    <div className="grid gap-2 md:grid-cols-2">
                      {projects.map((project) => (
                        <ProjectLearningRow key={project.id} project={project} />
                      ))}
                    </div>
                  ) : (
                    <EmptyState
                      title="还没有可用于学习的项目"
                      description="先创建项目并上传课程资料，再回到这里设置学习目标。"
                      action={
                        <Button asChild>
                          <Link href="/projects/new">创建第一个项目</Link>
                        </Button>
                      }
                    />
                  )}
                </section>
              </div>
            )}
          </div>

          <LearningCalendar className="xl:sticky xl:top-6" />
        </div>
      </div>
    </div>
  )
}
