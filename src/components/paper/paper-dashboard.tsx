"use client";

import Link from "next/link";
import { BookStack, Clock, NavArrowRight, Page, WarningTriangle } from "iconoir-react";
import { useFormattingTasks, type FormattingTaskSummary } from "@/lib/hooks/use-formatting";

const ACTIVE_STATUSES = new Set(["queued", "importing", "mapping", "needs_input", "rendering", "compiling", "validating"]);

function statusTone(task: FormattingTaskSummary) {
  if (task.status === "completed") return "text-[var(--color-accent)]";
  if (task.status === "failed") return "text-[var(--color-danger)]";
  if (task.status === "cancelled") return "text-[var(--color-text-tertiary)]";
  return "text-[var(--color-text-secondary)]";
}

function formatTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function TaskCard({ task }: { task: FormattingTaskSummary }) {
  const progress = task.status === "mapping" && task.totalUnits ? `（${task.completedUnits}/${task.totalUnits}）` : "";
  return (
    <Link href={`/papers/formatting/${task.id}`} className="group block bg-[var(--color-panel)] px-5 py-5 hover:bg-[var(--color-surface-hover)]">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-[var(--color-text-primary)]">{task.title}</h2>
          <p className="mt-1 truncate text-xs text-[var(--color-text-secondary)]">{task.originalName}</p>
        </div>
        <NavArrowRight className="mt-1 shrink-0 text-[var(--color-text-tertiary)] transition-transform group-hover:translate-x-0.5" width={15} height={15} />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
        <span className={statusTone(task)}>{task.stage}{progress}</span>
        <span className="text-[var(--color-text-tertiary)]">第 {task.attempt} 次</span>
        <span className="text-[var(--color-text-tertiary)]">更新于 {formatTime(task.updatedAt)}</span>
        {task.canRetry ? <span className="text-[var(--color-danger)]">{task.errorCode ?? "排版失败"}</span> : null}
      </div>
    </Link>
  );
}

export function PaperDashboard() {
  const tasksQuery = useFormattingTasks();
  const tasks = tasksQuery.data ?? [];
  const active = tasks.filter((task) => ACTIVE_STATUSES.has(task.status));
  const finished = tasks.filter((task) => !ACTIVE_STATUSES.has(task.status));

  return (
    <main className="h-full overflow-y-auto bg-[var(--color-bg)]">
      <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 sm:py-10">
        <div className="flex items-start justify-between gap-5">
          <div>
            <h1 className="text-2xl font-semibold tracking-[-0.025em] text-[var(--color-text-primary)]">论文排版</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-text-secondary)]">上传 Word 或 Markdown 原稿，选择学校模板，后台完成结构识别与排版。排版完成后可以在这里预览和下载 PDF，原始文稿始终保留。</p>
          </div>
          <BookStack className="hidden text-[var(--color-accent)] sm:block" width={28} height={28} strokeWidth={1.5} />
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <Link href="/papers/typesetting" className="inline-flex min-h-10 items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-accent)] px-4 text-sm font-medium text-white transition-opacity hover:opacity-90">上传原稿开始排版</Link>
          <Link href="/papers/templates" className="inline-flex min-h-10 items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-panel)] px-4 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]">模板库</Link>
        </div>

        {tasksQuery.isPending ? <p className="mt-8 text-sm text-[var(--color-text-tertiary)]">正在加载排版任务…</p> : tasksQuery.isError ? <p className="mt-8 text-sm text-[var(--color-danger)]">排版任务加载失败，请刷新重试。</p> : tasks.length === 0 ? (
          <div className="mt-8 bg-[var(--color-panel)] px-6 py-16 text-center"><Page className="mx-auto text-[var(--color-text-tertiary)]" width={24} height={24} /><p className="mt-3 text-sm text-[var(--color-text-secondary)]">还没有排版任务</p><p className="mt-1 text-xs text-[var(--color-text-tertiary)]">上传一份 DOCX 或 Markdown 原稿，选择学校模板即可开始。</p></div>
        ) : (
          <div className="mt-8 space-y-8">
            {active.length ? <section><h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]"><Clock width={16} height={16} />进行中</h2><div className="mt-3 grid gap-2 md:grid-cols-2">{active.map((task) => <TaskCard key={task.id} task={task} />)}</div></section> : null}
            {finished.length ? <section><h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]"><WarningTriangle width={16} height={16} />历史任务</h2><div className="mt-3 grid gap-2 md:grid-cols-2">{finished.map((task) => <TaskCard key={task.id} task={task} />)}</div></section> : null}
          </div>
        )}
      </div>
    </main>
  );
}
