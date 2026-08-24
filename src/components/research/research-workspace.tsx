"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BrainResearch, Check, Refresh } from "iconoir-react";
import { Button } from "@/components/ui/button";
import { MarkdownContent } from "@/components/markdown/markdown-content";
import { ResearchEvidencePanel } from "@/components/research/research-evidence-panel";
import { ResearchClaimsPanel } from "@/components/research/research-claims-panel";
import { ResearchPaperTransferPanel } from "@/components/research/research-paper-transfer-panel";
import { ResearchReportEvidencePanel } from "@/components/research/research-report-evidence-panel";
import { useAppendResearchDirective, useCancelResearchRun, useConfirmResearchPlan, useConfirmResearchScope, useCreateResearchFollowUp, useCreateResearchRun, useResearchRun, useResearchWorkspace, useReviseResearchPlan } from "@/lib/hooks/use-research";
import { linkifyResearchEvidenceMarkers, researchEvidenceIdFromAnchor } from "@/lib/research/report-citations";

interface ResearchRunDetail {
  id: string;
  question: string;
  status: string;
  agentExecutionId?: string | null;
  activePlanVersion?: { plan: ResearchPlan } | null;
  questions: Array<{ id: string; key: string; title: string; question: string; priority: string; status: string; completionCriteria: unknown }>;
  tasks: Array<{ id: string; title: string; status: string; priority: string }>;
  directives: Array<{ id: string; text: string; impact: string; status: string; createdAt: string }>;
  evidence: Array<{ id: string; sourceSnapshotId: string; statement: string; excerpt: string; locator: Record<string, unknown>; evidenceType: string; status: string; tags: string[]; sourceSnapshot?: { id: string; retrievedAt: string; source?: { title?: string | null; canonicalKey: string; canonicalUrl?: string | null } } | null }>;
  claims: Array<{ id: string; statement: string; userEdited: boolean; verificationStatus: string; quality?: { label?: string; reason?: string } | null; evidenceRelations: Array<{ relation: string; evidence: { id: string; statement: string; status: string; sourceSnapshotId: string } }> }>;
  _count: { sourceSnapshots: number; evidence: number; claims: number };
  budgetSnapshot?: { profile: string; modelCalls: number; searchCalls: number; fetchCalls: number; maxSources: number; maxTokens: number; maxCostCredits: number; maxVerificationRepairs: number } | null;
  metrics?: { modelCalls?: number; searchCalls?: number; fetchCalls?: number; sourceCount?: number; totalTokens?: number; costCredits?: number; verificationRepairs?: number } | null;
  reportSnapshot?: { reportDocument: { body?: string; title?: string; evidenceRefs?: string[] }; citationMap?: Record<string, Array<{ evidenceId: string; sourceSnapshotId: string; relation: string }>>; verificationSummary?: unknown; generatedAt: string } | null;
}

interface ResearchBudgetCounters {
  modelCalls?: number;
  searchCalls?: number;
  fetchCalls?: number;
  sourceCount?: number;
  totalTokens?: number;
  costCredits?: number;
  verificationRepairs?: number;
}

interface ResearchPublicEvent {
  runId?: string;
  kind?: string;
  message?: string;
  createdAt?: string;
  publicData?: {
    queries?: string[];
    query?: string;
    counters?: ResearchBudgetCounters;
    provider?: string;
    snapshotId?: string;
    sourceId?: string;
  };
}

function questionCompletion(status: string): number {
  if (status === "resolved") return 100;
  if (status === "partially_resolved") return 65;
  if (status === "controversial") return 50;
  if (status === "evaluating") return 75;
  if (status === "researching") return 35;
  return 0;
}

interface ResearchPlan {
  researchGoal: string;
  scope: string;
  timeRange: string | null;
  sourceStrategy: string[];
  completionCriteria: string[];
  expectedOutputs: string[];
  researchIntensity: string;
  domainProfile?: { name: string; sourcePriorities: string[]; evidenceStandards: string[]; citationRules: string[]; outputStructure: string[]; preferredProviders: string[] };
}

export function ResearchWorkspaceView({ workspaceId }: { workspaceId: string }) {
  const workspaceQuery = useResearchWorkspace(workspaceId);
  const workspace = workspaceQuery.data as { id: string; name: string; project?: { name: string } | null; runs: Array<{ id: string; question: string; status: string; createdAt: string }> } | undefined;
  const [question, setQuestion] = useState("");
  const [budgetProfile, setBudgetProfile] = useState<"quick" | "deep" | "comprehensive">("deep");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const activeRunId = selectedRunId ?? workspace?.runs[0]?.id ?? null;
  const createRunMutation = useCreateResearchRun(workspaceId);
  const runQuery = useResearchRun(activeRunId);
  const run = runQuery.data as ResearchRunDetail | undefined;
  const cancelRun = useCancelResearchRun(activeRunId ?? "none", workspaceId);
  const createFollowUp = useCreateResearchFollowUp(activeRunId ?? "none", workspaceId);
  const confirmPlan = useConfirmResearchPlan(activeRunId ?? "none", workspaceId);
  const revisePlan = useReviseResearchPlan(activeRunId ?? "none", workspaceId);
  const appendDirective = useAppendResearchDirective(activeRunId ?? "none", workspaceId);
  const confirmScope = useConfirmResearchScope(activeRunId ?? "none", workspaceId);
  const [directive, setDirective] = useState("");
  const [scopeBudget, setScopeBudget] = useState<"deep" | "comprehensive">("deep");
  const [planDirective, setPlanDirective] = useState("");
  const [followUpQuestion, setFollowUpQuestion] = useState("");
  const [liveMessage, setLiveMessage] = useState("");
  const [liveBudget, setLiveBudget] = useState<{ runId: string; counters: ResearchBudgetCounters } | null>(null);
  const [publicEvents, setPublicEvents] = useState<ResearchPublicEvent[]>([]);
  const [publicEventsRunId, setPublicEventsRunId] = useState<string | null>(null);
  const [selectedReportEvidenceId, setSelectedReportEvidenceId] = useState<string | null>(null);

  useEffect(() => {
    if (!run?.agentExecutionId) return;
    const events = new EventSource(`/api/research/runs/${run.id}/events`);
    events.addEventListener("research", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as ResearchPublicEvent;
        if (payload.message) setLiveMessage(payload.message);
        if (payload.publicData?.counters) setLiveBudget({ runId: run.id, counters: payload.publicData.counters });
        setPublicEventsRunId(run.id);
        setPublicEvents((current) => {
          const eventRunId = payload.runId ?? run.id;
          const sameRunEvents = current.filter((item) => (item.runId ?? run.id) === eventRunId);
          return [{ ...payload, runId: eventRunId }, ...sameRunEvents].slice(0, 40);
        });
      } catch { /* malformed public event is ignored */ }
    });
    return () => events.close();
  }, [run?.agentExecutionId, run?.id]);

  const plan = useMemo(() => run?.activePlanVersion?.plan, [run?.activePlanVersion?.plan]);
  const reportBody = run?.reportSnapshot
    ? linkifyResearchEvidenceMarkers(run.reportSnapshot.reportDocument.body ?? "", run.reportSnapshot.reportDocument.evidenceRefs ?? [])
    : "";
  const visiblePublicEvents = publicEventsRunId === run?.id ? publicEvents : [];

  function handleReportCitationClick(event: React.MouseEvent<HTMLDivElement>) {
    const anchor = (event.target as HTMLElement).closest("a");
    const evidenceId = anchor ? researchEvidenceIdFromAnchor(anchor.getAttribute("href") ?? "") : null;
    if (!evidenceId) return;
    event.preventDefault();
    setSelectedReportEvidenceId(evidenceId);
  }

  async function createRun(event: React.FormEvent) {
    event.preventDefault();
    if (!question.trim()) return;
    const created = await createRunMutation.mutateAsync({ question: question.trim(), budgetProfile }) as { id: string };
    setQuestion("");
    setSelectedRunId(created.id);
  }

  async function createFollowUpRun(event: React.FormEvent) {
    event.preventDefault();
    if (!followUpQuestion.trim()) return;
    const created = await createFollowUp.mutateAsync(followUpQuestion.trim());
    setFollowUpQuestion("");
    setSelectedRunId(created.id);
  }

  if (workspaceQuery.isPending || !workspace) return <main className="flex h-full items-center justify-center text-sm text-[var(--color-text-tertiary)]">正在加载研究工作区…</main>;

  return (
    <main className="h-full overflow-y-auto bg-[var(--color-bg)]">
      <div className="mx-auto max-w-6xl px-5 py-6 sm:px-8 sm:py-8">
        <Link href="/research" className="inline-flex items-center gap-1 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"><ArrowLeft width={14} height={14} />深度研究</Link>
        <div className="mt-5 flex items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">{workspace.name}</h1><p className="mt-1 text-sm text-[var(--color-text-secondary)]">{workspace.project?.name ? `关联项目：${workspace.project.name}` : "独立研究上下文"}</p></div><BrainResearch className="text-[var(--color-accent)]" width={26} height={26} strokeWidth={1.5} /></div>

              <form onSubmit={createRun} className="mt-8 flex max-w-3xl flex-wrap gap-2"><textarea value={question} onChange={(event) => setQuestion(event.target.value)} rows={2} placeholder="输入研究问题，例如：比较两种方法在近五年公开证据中的适用边界" className="min-h-20 min-w-0 flex-1 resize-y rounded-[var(--radius-md)] bg-[var(--color-panel)] px-3 py-2 text-sm leading-6 text-[var(--color-text-primary)] outline-none ring-1 ring-transparent placeholder:text-[var(--color-text-tertiary)] focus:ring-[var(--color-accent)]" /><select value={budgetProfile} onChange={(event) => setBudgetProfile(event.target.value as "quick" | "deep" | "comprehensive")} aria-label="本次研究预算配置" className="min-h-10 rounded-[var(--radius-md)] bg-[var(--color-panel)] px-3 py-2 text-xs text-[var(--color-text-secondary)] outline-none ring-1 ring-transparent focus:ring-[var(--color-accent)]"><option value="quick">Quick · 快速</option><option value="deep">Deep · 深入</option><option value="comprehensive">Comprehensive · 全面</option></select><Button type="submit" variant="primary" size="sm" className="self-end" disabled={createRunMutation.isPending}>开始规划</Button></form>

        <div className="mt-8 grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
          <aside><p className="mb-2 px-1 text-xs text-[var(--color-text-tertiary)]">研究运行</p><div className="space-y-1">{workspace.runs.map((item) => <button key={item.id} type="button" onClick={() => setSelectedRunId(item.id)} className={`block w-full rounded-[var(--radius-md)] px-3 py-3 text-left ${activeRunId === item.id ? "bg-[var(--color-interaction-selected)] text-[var(--color-text-primary)]" : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"}`}><span className="block truncate text-xs font-medium">{item.question}</span><span className="mt-1 block text-[11px] text-[var(--color-text-tertiary)]">{item.status}</span></button>)}</div></aside>
          <section className="min-w-0">
            {!run ? <div className="py-20 text-center text-sm text-[var(--color-text-tertiary)]">选择一次运行，查看计划与公开进度。</div> : <>
              <div className="flex flex-wrap items-center gap-3"><span className="rounded-full bg-[var(--color-interaction-selected)] px-3 py-1 text-xs text-[var(--color-accent)]">{run.status}</span>{liveMessage ? <span className="text-xs text-[var(--color-text-secondary)]">{liveMessage}</span> : null}<span className="ml-auto text-xs text-[var(--color-text-tertiary)]">{run._count.sourceSnapshots} 来源 · {run._count.evidence} Evidence · {run._count.claims} Claim</span>{!['completed', 'failed', 'cancelled'].includes(run.status) ? <Button type="button" variant="ghost" size="sm" onClick={() => { if (window.confirm("确定取消这次 Research Run 吗？已保存的研究资产不会删除。")) cancelRun.mutate(); }} disabled={cancelRun.isPending}>取消运行</Button> : null}</div>
              {run.budgetSnapshot ? <div className="mt-5 bg-[var(--color-panel)] px-5 py-4"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold text-[var(--color-text-primary)]">预算状态</h2><span className="text-xs text-[var(--color-text-tertiary)]">{run.budgetSnapshot.profile}</span></div>{(() => { const counters = liveBudget?.runId === run.id ? liveBudget.counters : run.metrics ?? {}; return <div className="mt-3 grid gap-3 text-xs text-[var(--color-text-secondary)] sm:grid-cols-3"><span>模型调用 {counters.modelCalls ?? 0}/{run.budgetSnapshot.modelCalls}</span><span>检索 {counters.searchCalls ?? 0}/{run.budgetSnapshot.searchCalls}</span><span>读取 {counters.fetchCalls ?? 0}/{run.budgetSnapshot.fetchCalls}</span><span>来源 {counters.sourceCount ?? run._count.sourceSnapshots}/{run.budgetSnapshot.maxSources}</span><span>Token {counters.totalTokens ?? 0}/{run.budgetSnapshot.maxTokens}</span><span>Repair {counters.verificationRepairs ?? 0}/{run.budgetSnapshot.maxVerificationRepairs}</span></div>; })()}</div> : null}
              {plan ? <div className="mt-5 space-y-5"><div className="bg-[var(--color-panel)] px-5 py-5"><h2 className="text-base font-semibold text-[var(--color-text-primary)]">研究计划</h2><p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">{plan.scope}</p><div className="mt-5 grid gap-4 sm:grid-cols-3"><div><p className="text-xs text-[var(--color-text-tertiary)]">研究目标</p><p className="mt-1 text-sm text-[var(--color-text-primary)]">{plan.researchGoal}</p></div><div><p className="text-xs text-[var(--color-text-tertiary)]">研究强度</p><p className="mt-1 text-sm text-[var(--color-text-primary)]">{plan.researchIntensity}</p></div><div><p className="text-xs text-[var(--color-text-tertiary)]">时间范围</p><p className="mt-1 text-sm text-[var(--color-text-primary)]">{plan.timeRange ?? "未限定"}</p></div><div><p className="text-xs text-[var(--color-text-tertiary)]">领域 Profile</p><p className="mt-1 text-sm text-[var(--color-text-primary)]">{plan.domainProfile?.name ?? "通用研究"}</p></div></div><div className="mt-5 grid gap-5 sm:grid-cols-2"><div><p className="text-xs text-[var(--color-text-tertiary)]">来源策略</p><ul className="mt-2 space-y-1 text-sm leading-6 text-[var(--color-text-secondary)]">{plan.sourceStrategy.map((item) => <li key={item}>· {item}</li>)}</ul></div><div><p className="text-xs text-[var(--color-text-tertiary)]">预期产出</p><ul className="mt-2 space-y-1 text-sm leading-6 text-[var(--color-text-secondary)]">{plan.expectedOutputs.map((item) => <li key={item}>· {item}</li>)}</ul></div></div><div className="mt-5"><p className="text-xs text-[var(--color-text-tertiary)]">完成标准</p><ul className="mt-2 space-y-1 text-sm leading-6 text-[var(--color-text-secondary)]">{plan.completionCriteria.map((item) => <li key={item}>· {item}</li>)}</ul></div><div className="mt-5"><p className="text-xs text-[var(--color-text-tertiary)]">Research Questions</p><div className="mt-2 space-y-2">{run.questions.map((item) => <div key={item.id} className="flex items-start gap-2 text-sm text-[var(--color-text-primary)]"><span className="mt-1 text-[var(--color-accent)]">{item.status === "resolved" ? <Check width={14} height={14} /> : <Refresh width={14} height={14} />}</span><span>{item.title}<span className="ml-2 text-xs text-[var(--color-text-tertiary)]">{item.priority} · {item.status}</span><span className="mt-1 block text-xs leading-5 text-[var(--color-text-tertiary)]">完成标准：{Array.isArray(item.completionCriteria) && item.completionCriteria.length > 0 ? item.completionCriteria.join("；") : "按研究计划判断"}</span></span></div>)}</div></div>{run.status === "awaiting_confirmation" ? <><form className="mt-6 flex gap-2" onSubmit={(event) => { event.preventDefault(); if (!planDirective.trim()) return; revisePlan.mutate(planDirective.trim(), { onSuccess: () => setPlanDirective("") }); }}><input value={planDirective} onChange={(event) => setPlanDirective(event.target.value)} placeholder="用自然语言调整计划，例如：增加一个医学安全性问题" className="min-w-0 flex-1 rounded-[var(--radius-md)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none ring-1 ring-transparent placeholder:text-[var(--color-text-tertiary)] focus:ring-[var(--color-accent)]" /><Button type="submit" variant="secondary" size="sm" disabled={revisePlan.isPending}>调整计划</Button></form><Button type="button" variant="primary" size="sm" className="mt-3" onClick={() => confirmPlan.mutate()} disabled={confirmPlan.isPending}><Check width={16} height={16} />确认计划并开始</Button></> : null}</div></div> : null}
              <div className="mt-5 bg-[var(--color-panel)] px-5 py-5"><h2 className="text-base font-semibold text-[var(--color-text-primary)]">追加研究方向</h2><p className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">普通调整会在后续评估中吸收；明显扩大范围或预算会暂停并等待确认。</p><form className="mt-3 flex gap-2" onSubmit={(event) => { event.preventDefault(); if (!directive.trim()) return; appendDirective.mutate(directive.trim(), { onSuccess: () => setDirective("") }); }}><input value={directive} onChange={(event) => setDirective(event.target.value)} placeholder="例如：补充近三年的官方数据" className="min-w-0 flex-1 rounded-[var(--radius-md)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none ring-1 ring-transparent placeholder:text-[var(--color-text-tertiary)] focus:ring-[var(--color-accent)]" /><Button type="submit" variant="secondary" size="sm" disabled={appendDirective.isPending}>追加</Button></form></div>
              {run.status === "awaiting_scope_confirmation" ? <div className="mt-5 bg-[var(--color-info-muted)] px-5 py-5"><h2 className="text-base font-semibold text-[var(--color-text-primary)]">确认扩大范围后继续</h2><p className="mt-1 text-sm leading-6 text-[var(--color-text-secondary)]">当前 Durable Execution 已暂停在队列中；确认后会复用同一个执行记录继续，不会创建第二套 Worker。</p><div className="mt-4 space-y-2">{run.directives.filter((item) => item.status === "needs_confirmation").map((item) => <div key={item.id} className="text-sm text-[var(--color-text-primary)]">{item.text}<span className="ml-2 text-xs text-[var(--color-text-tertiary)]">{item.impact === "budget_expansion" ? "预算扩大" : "范围扩大"}</span></div>)}</div><div className="mt-5 flex flex-wrap items-center gap-2"><Button type="button" variant="primary" size="sm" onClick={() => confirmScope.mutate({ approved: true, ...(run.directives.some((item) => item.impact === "budget_expansion") ? { budgetProfile: scopeBudget } : {}) })} disabled={confirmScope.isPending}><Check width={16} height={16} />确认并继续</Button><Button type="button" variant="secondary" size="sm" onClick={() => confirmScope.mutate({ approved: false })} disabled={confirmScope.isPending}>拒绝扩大，继续原计划</Button>{run.directives.some((item) => item.impact === "budget_expansion") ? <select value={scopeBudget} onChange={(event) => setScopeBudget(event.target.value as "deep" | "comprehensive")} className="rounded-[var(--radius-md)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text-primary)]"><option value="deep">Deep 预算</option><option value="comprehensive">Comprehensive 预算</option></select> : null}</div></div> : null}
              <div className="mt-5 grid gap-5 xl:grid-cols-2"><div className="bg-[var(--color-panel)] px-5 py-5"><h2 className="text-base font-semibold text-[var(--color-text-primary)]">Question 完成度</h2><div className="mt-3 space-y-3">{run.questions.map((item) => { const completion = questionCompletion(item.status); return <div key={item.id}><div className="flex items-center justify-between gap-3 text-xs"><span className="truncate text-[var(--color-text-secondary)]">{item.title}</span><span className="shrink-0 text-[var(--color-text-tertiary)]">{completion}% · {item.status}</span></div><div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--color-separator)]"><div className="h-full rounded-full bg-[var(--color-accent)] transition-[width]" style={{ width: `${completion}%` }} /></div></div>; })}</div></div><div className="bg-[var(--color-panel)] px-5 py-5"><h2 className="text-base font-semibold text-[var(--color-text-primary)]">当前任务</h2><div className="mt-3 space-y-2">{run.tasks.filter((task) => ["running", "retrying", "pending"].includes(task.status)).slice(0, 8).map((task) => <div key={task.id} className="flex items-center justify-between gap-3 text-sm"><span className="truncate text-[var(--color-text-secondary)]">{task.title}</span><span className="shrink-0 text-xs text-[var(--color-text-tertiary)]">{task.status}</span></div>)}{run.tasks.every((task) => !["running", "retrying", "pending"].includes(task.status)) ? <p className="text-xs text-[var(--color-text-tertiary)]">当前没有待处理任务。</p> : null}</div></div></div>
              <div className="mt-5 bg-[var(--color-panel)] px-5 py-5"><div className="flex items-center justify-between gap-3"><h2 className="text-base font-semibold text-[var(--color-text-primary)]">公开执行事件</h2><span className="text-xs text-[var(--color-text-tertiary)]">仅显示公开状态、检索词和来源，不含隐藏推理</span></div><div className="mt-3 max-h-80 space-y-2 overflow-y-auto">{visiblePublicEvents.length === 0 ? <p className="text-xs text-[var(--color-text-tertiary)]">等待 Durable Execution 事件…</p> : visiblePublicEvents.map((event, index) => <div key={`${event.createdAt ?? "event"}-${index}`} className="rounded-[var(--radius-sm)] bg-[var(--color-bg)] px-3 py-2 text-xs"><div className="flex items-start justify-between gap-3"><p className="leading-5 text-[var(--color-text-secondary)]">{event.message ?? event.kind ?? "研究事件"}</p>{event.createdAt ? <time className="shrink-0 text-[10px] text-[var(--color-text-tertiary)]">{new Date(event.createdAt).toLocaleTimeString("zh-CN")}</time> : null}</div>{event.publicData?.queries?.length ? <p className="mt-1 text-[11px] text-[var(--color-accent)]">检索词：{event.publicData.queries.join(" · ")}</p> : null}{event.publicData?.query ? <p className="mt-1 text-[11px] text-[var(--color-accent)]">检索词：{event.publicData.query}</p> : null}{event.publicData?.provider ? <p className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">Provider：{event.publicData.provider}{event.publicData.snapshotId ? ` · Snapshot ${event.publicData.snapshotId.slice(0, 10)}` : ""}</p> : null}</div>)}</div></div>
              <ResearchEvidencePanel runId={run.id} workspaceId={workspaceId} evidence={run.evidence} />
              <ResearchClaimsPanel runId={run.id} workspaceId={workspaceId} claims={run.claims} evidence={run.evidence} />
              <ResearchPaperTransferPanel runId={run.id} workspaceId={workspaceId} />
              {['completed', 'failed'].includes(run.status) ? <section className="mt-5 bg-[var(--color-panel)] px-5 py-5"><h2 className="text-base font-semibold text-[var(--color-text-primary)]">继续研究</h2><p className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">创建新的 Follow-up Run；当前 Run、Plan 和 Report 保持不可修改，并继承已有研究资产作为待重新评估的上下文。</p><form className="mt-4 flex flex-wrap gap-2" onSubmit={createFollowUpRun}><input value={followUpQuestion} onChange={(event) => setFollowUpQuestion(event.target.value)} required minLength={3} placeholder="例如：补充反方证据，或更新到最近一年" className="min-w-0 flex-1 rounded-[var(--radius-md)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none ring-1 ring-transparent placeholder:text-[var(--color-text-tertiary)] focus:ring-[var(--color-accent)]" /><Button type="submit" variant="secondary" size="sm" disabled={createFollowUp.isPending}>创建 Follow-up Run</Button></form></section> : null}
              {run.reportSnapshot ? <div className="mt-5 bg-[var(--color-panel)] px-5 py-5"><div className="flex items-center justify-between gap-3"><h2 className="text-base font-semibold text-[var(--color-text-primary)]">不可修改的研究报告快照</h2><span className="text-xs text-[var(--color-text-tertiary)]">已完成引用核验</span></div><div className="mt-5 grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]"><div onClick={handleReportCitationClick}><MarkdownContent content={reportBody} /></div><ResearchReportEvidencePanel claims={run.claims} evidence={run.evidence} citationMap={run.reportSnapshot.citationMap} evidenceRefs={run.reportSnapshot.reportDocument.evidenceRefs ?? []} selectedEvidenceId={selectedReportEvidenceId} onSelectEvidence={setSelectedReportEvidenceId} /></div></div> : null}
            </>}
          </section>
        </div>
      </div>
    </main>
  );
}
