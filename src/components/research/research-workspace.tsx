"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BrainResearch, Check, Refresh } from "iconoir-react";
import { Button } from "@/components/ui/button";
import { MarkdownContent } from "@/components/markdown/markdown-content";
import { useConfirmResearchPlan, useCreateResearchRun, useResearchRun, useResearchWorkspace } from "@/lib/hooks/use-research";

interface ResearchRunDetail {
  id: string;
  question: string;
  status: string;
  agentExecutionId?: string | null;
  activePlanVersion?: { plan: ResearchPlan } | null;
  questions: Array<{ id: string; key: string; title: string; question: string; priority: string; status: string; completionCriteria: unknown }>;
  tasks: Array<{ id: string; title: string; status: string; priority: string }>;
  _count: { sourceSnapshots: number; evidence: number; claims: number };
  reportSnapshot?: { reportDocument: { body?: string; title?: string }; verificationSummary?: unknown; generatedAt: string } | null;
}

interface ResearchPlan {
  researchGoal: string;
  scope: string;
  timeRange: string | null;
  sourceStrategy: string[];
  completionCriteria: string[];
  expectedOutputs: string[];
  researchIntensity: string;
}

export function ResearchWorkspaceView({ workspaceId }: { workspaceId: string }) {
  const workspaceQuery = useResearchWorkspace(workspaceId);
  const workspace = workspaceQuery.data as { id: string; name: string; project?: { name: string } | null; runs: Array<{ id: string; question: string; status: string; createdAt: string }> } | undefined;
  const [question, setQuestion] = useState("");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const activeRunId = selectedRunId ?? workspace?.runs[0]?.id ?? null;
  const createRunMutation = useCreateResearchRun(workspaceId);
  const runQuery = useResearchRun(activeRunId);
  const run = runQuery.data as ResearchRunDetail | undefined;
  const confirmPlan = useConfirmResearchPlan(activeRunId ?? "none", workspaceId);
  const [liveMessage, setLiveMessage] = useState("");

  useEffect(() => {
    if (!run?.agentExecutionId) return;
    const events = new EventSource(`/api/research/runs/${run.id}/events`);
    events.addEventListener("research", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as { message?: string };
        if (payload.message) setLiveMessage(payload.message);
      } catch { /* malformed public event is ignored */ }
    });
    return () => events.close();
  }, [run?.agentExecutionId, run?.id]);

  const plan = useMemo(() => run?.activePlanVersion?.plan, [run?.activePlanVersion?.plan]);

  async function createRun(event: React.FormEvent) {
    event.preventDefault();
    if (!question.trim()) return;
    const created = await createRunMutation.mutateAsync({ question: question.trim(), budgetProfile: "deep" }) as { id: string };
    setQuestion("");
    setSelectedRunId(created.id);
  }

  if (workspaceQuery.isPending || !workspace) return <main className="flex h-full items-center justify-center text-sm text-[var(--color-text-tertiary)]">正在加载研究工作区…</main>;

  return (
    <main className="h-full overflow-y-auto bg-[var(--color-bg)]">
      <div className="mx-auto max-w-6xl px-5 py-6 sm:px-8 sm:py-8">
        <Link href="/research" className="inline-flex items-center gap-1 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"><ArrowLeft width={14} height={14} />深度研究</Link>
        <div className="mt-5 flex items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">{workspace.name}</h1><p className="mt-1 text-sm text-[var(--color-text-secondary)]">{workspace.project?.name ? `关联项目：${workspace.project.name}` : "独立研究上下文"}</p></div><BrainResearch className="text-[var(--color-accent)]" width={26} height={26} strokeWidth={1.5} /></div>

              <form onSubmit={createRun} className="mt-8 flex max-w-3xl gap-2"><textarea value={question} onChange={(event) => setQuestion(event.target.value)} rows={2} placeholder="输入研究问题，例如：比较两种方法在近五年公开证据中的适用边界" className="min-h-20 min-w-0 flex-1 resize-y rounded-[var(--radius-md)] bg-[var(--color-panel)] px-3 py-2 text-sm leading-6 text-[var(--color-text-primary)] outline-none ring-1 ring-transparent placeholder:text-[var(--color-text-tertiary)] focus:ring-[var(--color-accent)]" /><Button type="submit" variant="primary" size="sm" className="self-end" disabled={createRunMutation.isPending}>开始规划</Button></form>

        <div className="mt-8 grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
          <aside><p className="mb-2 px-1 text-xs text-[var(--color-text-tertiary)]">研究运行</p><div className="space-y-1">{workspace.runs.map((item) => <button key={item.id} type="button" onClick={() => setSelectedRunId(item.id)} className={`block w-full rounded-[var(--radius-md)] px-3 py-3 text-left ${activeRunId === item.id ? "bg-[var(--color-interaction-selected)] text-[var(--color-text-primary)]" : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"}`}><span className="block truncate text-xs font-medium">{item.question}</span><span className="mt-1 block text-[11px] text-[var(--color-text-tertiary)]">{item.status}</span></button>)}</div></aside>
          <section className="min-w-0">
            {!run ? <div className="py-20 text-center text-sm text-[var(--color-text-tertiary)]">选择一次运行，查看计划与公开进度。</div> : <>
              <div className="flex flex-wrap items-center gap-3"><span className="rounded-full bg-[var(--color-interaction-selected)] px-3 py-1 text-xs text-[var(--color-accent)]">{run.status}</span>{liveMessage ? <span className="text-xs text-[var(--color-text-secondary)]">{liveMessage}</span> : null}<span className="ml-auto text-xs text-[var(--color-text-tertiary)]">{run._count.sourceSnapshots} 来源 · {run._count.evidence} Evidence · {run._count.claims} Claim</span></div>
              {plan ? <div className="mt-5 space-y-5"><div className="bg-[var(--color-panel)] px-5 py-5"><h2 className="text-base font-semibold text-[var(--color-text-primary)]">研究计划</h2><p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">{plan.scope}</p><div className="mt-5 grid gap-4 sm:grid-cols-2"><div><p className="text-xs text-[var(--color-text-tertiary)]">研究目标</p><p className="mt-1 text-sm text-[var(--color-text-primary)]">{plan.researchGoal}</p></div><div><p className="text-xs text-[var(--color-text-tertiary)]">研究强度</p><p className="mt-1 text-sm text-[var(--color-text-primary)]">{plan.researchIntensity}</p></div></div><div className="mt-5"><p className="text-xs text-[var(--color-text-tertiary)]">来源策略</p><ul className="mt-2 space-y-1 text-sm leading-6 text-[var(--color-text-secondary)]">{plan.sourceStrategy.map((item) => <li key={item}>· {item}</li>)}</ul></div><div className="mt-5"><p className="text-xs text-[var(--color-text-tertiary)]">Research Questions</p><div className="mt-2 space-y-2">{run.questions.map((item) => <div key={item.id} className="flex items-start gap-2 text-sm text-[var(--color-text-primary)]"><span className="mt-1 text-[var(--color-accent)]">{item.status === "resolved" ? <Check width={14} height={14} /> : <Refresh width={14} height={14} />}</span><span>{item.title}<span className="ml-2 text-xs text-[var(--color-text-tertiary)]">{item.priority} · {item.status}</span></span></div>)}</div></div>{run.status === "awaiting_confirmation" ? <Button type="button" variant="primary" size="sm" className="mt-6" onClick={() => confirmPlan.mutate()} disabled={confirmPlan.isPending}><Check width={16} height={16} />确认计划并开始</Button> : null}</div></div> : null}
              <div className="mt-5 bg-[var(--color-panel)] px-5 py-5"><h2 className="text-base font-semibold text-[var(--color-text-primary)]">公开执行任务</h2><div className="mt-3 space-y-2">{run.tasks.map((task) => <div key={task.id} className="flex items-center justify-between gap-3 text-sm"><span className="truncate text-[var(--color-text-secondary)]">{task.title}</span><span className="shrink-0 text-xs text-[var(--color-text-tertiary)]">{task.status}</span></div>)}</div></div>
              {run.reportSnapshot ? <div className="mt-5 bg-[var(--color-panel)] px-5 py-5"><div className="flex items-center justify-between gap-3"><h2 className="text-base font-semibold text-[var(--color-text-primary)]">不可修改的研究报告快照</h2><span className="text-xs text-[var(--color-text-tertiary)]">已完成引用核验</span></div><div className="mt-5"><MarkdownContent content={run.reportSnapshot.reportDocument.body ?? ""} /></div></div> : null}
            </>}
          </section>
        </div>
      </div>
    </main>
  );
}
