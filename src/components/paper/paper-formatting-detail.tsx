"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle, Download, Page, RefreshDouble, Xmark } from "iconoir-react";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/api/client";
import { useCancelFormatting, useConfirmFormatting, useFormattingTask, useRetryFormatting, type FormattingReview, type FormattingRole } from "@/lib/hooks/use-formatting";
import { PaperPdfViewer } from "./paper-pdf-viewer";

const ROLE_LABELS: Record<FormattingRole["role"], string> = { keep: "保持原样", heading: "标题", abstract_zh: "中文摘要", abstract_en: "英文摘要", acknowledgement: "致谢" };
const ROLE_OPTIONS: FormattingRole["role"][] = ["keep", "heading", "abstract_zh", "abstract_en", "acknowledgement"];

function ConfirmPanel({ taskId, review }: { taskId: string; review: FormattingReview }) {
  const [roles, setRoles] = useState<FormattingRole[]>(review.roles);
  const [message, setMessage] = useState("");
  const confirm = useConfirmFormatting(taskId);

  function update(index: number, role: FormattingRole["role"], level?: number) {
    setRoles((current) => current.map((item, position) => position === index ? { ...item, role, confidence: 1, ...(role === "heading" ? { level: level ?? item.level ?? 1 } : { level: undefined }) } : item));
  }

  async function submit() {
    setMessage("");
    try {
      await confirm.mutateAsync(roles.map((role) => ({ blockId: role.blockId, role: role.role, confidence: 1, ...(role.role === "heading" ? { level: role.level ?? 1 } : {}) })));
    } catch (error) {
      setMessage(errorMessage(error, "确认失败，请稍后重试"));
    }
  }

  const lowConfidence = review.roles.filter((role) => role.confidence < 0.8).length;
  return (
    <section className="bg-[var(--color-panel)] px-5 py-6 sm:px-6">
      <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">确认原稿结构</h2>
      <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">AI 只判断章节角色，不改写正文。请核对以下结构后确认；确认后才会生成排版版本并开始编译。{lowConfidence ? `其中 ${lowConfidence} 个块置信度较低，已用“保持原样”标注。` : ""}</p>
      {review.warnings.length ? <ul className="mt-3 space-y-1 text-[11px] text-[var(--color-text-tertiary)]">{review.warnings.map((warning, index) => <li key={index}>{warning.reason ?? "有低置信度内容需要确认"}</li>)}</ul> : null}
      <div className="mt-4 max-h-[26rem] space-y-1.5 overflow-y-auto pr-1">
        {review.blocks.map((block, index) => {
          const role = roles[index];
          if (!role) return null;
          const editable = block.kind === "paragraph" || block.kind === "heading";
          return (
            <div key={block.blockId} className="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-panel-muted)] px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-xs text-[var(--color-text-primary)]">{block.title || `（空 ${block.kind}）`}</span>
              <span className="shrink-0 text-[11px] text-[var(--color-text-tertiary)]">{block.kind} · {block.characters} 字</span>
              {editable ? (
                <>
                  <select value={role.role} onChange={(event) => update(index, event.target.value as FormattingRole["role"])} aria-label={`块 ${index + 1} 的角色`} className="min-h-8 rounded-[var(--radius-md)] bg-[var(--color-bg)] px-2 text-xs text-[var(--color-text-secondary)] outline-none ring-1 ring-[var(--color-border-light)] focus:ring-[var(--color-accent)]">{ROLE_OPTIONS.map((option) => <option key={option} value={option}>{ROLE_LABELS[option]}</option>)}</select>
                  {role.role === "heading" ? <select value={role.level ?? 1} onChange={(event) => update(index, "heading", Number(event.target.value))} aria-label={`块 ${index + 1} 的标题层级`} className="min-h-8 rounded-[var(--radius-md)] bg-[var(--color-bg)] px-2 text-xs text-[var(--color-text-secondary)] outline-none ring-1 ring-[var(--color-border-light)] focus:ring-[var(--color-accent)]">{[1, 2, 3, 4, 5, 6].map((level) => <option key={level} value={level}>{level} 级标题</option>)}</select> : null}
                  {role.confidence < 0.8 ? <span className="text-[11px] text-[var(--color-danger)]">待确认</span> : null}
                </>
              ) : <span className="text-[11px] text-[var(--color-text-tertiary)]">受保护，保持原样</span>}
            </div>
          );
        })}
      </div>
      {message ? <p className="mt-3 text-xs text-[var(--color-danger)]">{message}</p> : null}
      <Button type="button" variant="primary" size="sm" className="mt-4" disabled={confirm.isPending} onClick={submit}><CheckCircle width={16} height={16} />{confirm.isPending ? "正在确认…" : "确认结构并开始排版"}</Button>
    </section>
  );
}

export function PaperFormattingDetail({ taskId }: { taskId: string }) {
  const query = useFormattingTask(taskId);
  const cancel = useCancelFormatting(taskId);
  const retry = useRetryFormatting(taskId);
  const [message, setMessage] = useState("");
  const task = query.data?.task;
  const review = query.data?.review ?? null;

  async function run(action: "cancel" | "retry") {
    setMessage("");
    try {
      await (action === "cancel" ? cancel.mutateAsync() : retry.mutateAsync());
    } catch (error) {
      setMessage(errorMessage(error, "操作失败，请稍后重试"));
    }
  }

  if (query.isPending) return <main className="h-full overflow-y-auto bg-[var(--color-bg)]"><div className="mx-auto max-w-5xl px-5 py-10 sm:px-8"><p className="text-sm text-[var(--color-text-tertiary)]">正在加载排版任务…</p></div></main>;
  if (query.isError || !task) return <main className="h-full overflow-y-auto bg-[var(--color-bg)]"><div className="mx-auto max-w-5xl px-5 py-10 sm:px-8"><Link href="/papers" className="text-xs text-[var(--color-accent)] hover:underline">返回我的排版任务</Link><p className="mt-4 text-sm text-[var(--color-danger)]">排版任务不存在或无权访问。</p></div></main>;

  const progress = task.status === "mapping" && task.totalUnits ? Math.round((task.completedUnits / task.totalUnits) * 100) : null;
  return (
    <main className="h-full overflow-y-auto bg-[var(--color-bg)]">
      <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 sm:py-10">
        <Link href="/papers" className="inline-flex items-center gap-1 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"><ArrowLeft width={14} height={14} />我的排版任务</Link>
        <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0"><h1 className="truncate text-2xl font-semibold tracking-[-0.025em] text-[var(--color-text-primary)]">{task.title}</h1><p className="mt-2 text-xs text-[var(--color-text-secondary)]">{task.originalName} · 第 {task.attempt} 次提交</p></div>
          <div className="flex flex-wrap gap-2">
            {task.canCancel ? <Button type="button" variant="secondary" size="sm" disabled={cancel.isPending} onClick={() => run("cancel")}><Xmark width={16} height={16} />{cancel.isPending ? "正在取消…" : "取消排版"}</Button> : null}
            {task.canRetry ? <Button type="button" variant="primary" size="sm" disabled={retry.isPending} onClick={() => run("retry")}><RefreshDouble width={16} height={16} />{retry.isPending ? "正在重试…" : "重试排版"}</Button> : null}
            <a href={task.sourcePath} className="inline-flex min-h-9 items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-panel)] px-3 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"><Download width={16} height={16} />原稿</a>
            {task.compilationId ? <><a href={`/api/papers/compilations/${task.compilationId}/pdf`} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-accent-muted)] px-3 text-sm text-[var(--color-accent)] hover:opacity-90"><Page width={16} height={16} />PDF</a><a href={`/api/papers/compilations/${task.compilationId}/source`} className="inline-flex min-h-9 items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-panel)] px-3 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"><Download width={16} height={16} />LaTeX 工程</a></> : null}
          </div>
        </div>

        <section className="mt-6 bg-[var(--color-panel)] px-5 py-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="text-sm font-semibold text-[var(--color-text-primary)]">{task.stage}</h2>{task.totalUnits ? <p className="mt-1 text-xs text-[var(--color-text-secondary)]">已完成 {task.completedUnits} / {task.totalUnits} 组结构识别</p> : <p className="mt-1 text-xs text-[var(--color-text-secondary)]">后台会自动推进，可以离开页面，完成后会收到站内通知。</p>}</div>
            <span className="text-[11px] text-[var(--color-text-tertiary)]">更新于 {new Date(task.updatedAt).toLocaleString("zh-CN")}</span>
          </div>
          {progress !== null ? <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-panel-muted)]"><div className="h-full rounded-full bg-[var(--color-accent)] transition-[width]" style={{ width: `${progress}%` }} /></div> : null}
          {task.errorMessage ? <p className="mt-3 rounded-[var(--radius-md)] bg-[var(--color-danger-muted)] px-3 py-2 text-xs text-[var(--color-danger)]">{task.errorMessage}</p> : null}
          {message ? <p className="mt-3 text-xs text-[var(--color-danger)]">{message}</p> : null}
        </section>

        {review ? <div className="mt-4"><ConfirmPanel key={`${task.id}:${task.updatedAt}:${review.roles.length}`} taskId={taskId} review={review} /></div> : null}

        {task.status === "completed" && task.compilationId ? <section className="mt-4 bg-[var(--color-panel)] px-5 py-6 sm:px-6"><h2 className="text-sm font-semibold text-[var(--color-text-primary)]">排版结果</h2><p className="mt-1 text-xs text-[var(--color-text-secondary)]">已通过完整性校验的 PDF，可以直接下载或在此预览。</p><PaperPdfViewer pdfUrl={`/api/papers/compilations/${task.compilationId}/pdf`} /></section> : null}
      </div>
    </main>
  );
}
