"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BrainResearch, Check, Copy } from "iconoir-react";
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
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MarkdownContent } from "@/components/markdown/markdown-content";
import { ResearchEvidencePanel } from "@/components/research/research-evidence-panel";
import { ResearchClaimsPanel } from "@/components/research/research-claims-panel";
import { ResearchPaperTransferPanel } from "@/components/research/research-paper-transfer-panel";
import { ResearchReportEvidencePanel, ResearchCitationCard } from "@/components/research/research-report-evidence-panel";
import { ResearchSourcesPanel } from "@/components/research/research-sources-panel";
import { useAppendResearchDirective, useCancelResearchRun, useConfirmResearchPlan, useConfirmResearchScope, useCreateResearchFollowUp, useCreateResearchRun, useResearchRun, useResearchWorkspace, useReviseResearchPlan } from "@/lib/hooks/use-research";
import { buildResearchReportMarkdown, buildResearchBibliography, linkifyResearchEvidenceMarkers, researchEvidenceIdFromAnchor } from "@/lib/research/report-citations";
import {
  buildResearchProgressSummary,
  buildResearchSourceViews,
  formatResearchElapsed,
  researchQuestionCompletion,
  type ResearchCitationMap,
} from "@/lib/research/research-view-model";

interface ResearchRunDetail {
  id: string;
  question: string;
  status: string;
  stage?: { key: string; label: string };
  failureReason?: string | null;
  degradations?: Array<{ code: string; message: string }>;
  visualEvidence?: { enabled: boolean; observations: number; resources: number };
  agentExecutionId?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  activePlanVersion?: { plan: ResearchPlan } | null;
  questions: Array<{ id: string; key: string; title: string; question: string; priority: string; status: string; completionCriteria: unknown }>;
  tasks: Array<{ id: string; title: string; status: string; priority: string }>;
  directives: Array<{ id: string; text: string; impact: string; status: string; createdAt: string }>;
  evidence: Array<{ id: string; sourceSnapshotId: string; statement: string; excerpt: string; locator: Record<string, unknown>; evidenceType: string; status: string; tags: string[]; sourceSnapshot?: { id: string; retrievedAt: string; metadata?: unknown; source?: { id: string; title?: string | null; kind?: string; canonicalKey: string; canonicalUrl?: string | null; doi?: string | null; metadata?: unknown } | null } | null }>;
  claims: Array<{ id: string; statement: string; userEdited: boolean; verificationStatus: string; quality?: { label?: string; reason?: string } | null; evidenceRelations: Array<{ relation: string; evidence: { id: string; statement: string; status: string; sourceSnapshotId: string } }> }>;
  sourceRelations?: Array<{ id: string; sourceId: string; targetSourceId: string | null; relation: string }>;
  _count: { sourceSnapshots: number; evidence: number; claims: number };
  budgetSnapshot?: { profile: string; modelCalls: number; searchCalls: number; fetchCalls: number; maxSources: number; maxTokens: number; maxCostCredits: number; maxVerificationRepairs: number } | null;
  metrics?: { modelCalls?: number; searchCalls?: number; fetchCalls?: number; sourceCount?: number; totalTokens?: number; costCredits?: number; verificationRepairs?: number; degradationCount?: number; degradations?: string[] } | null;
  reportSnapshot?: {
    reportDocument: { body?: string; title?: string; evidenceRefs?: string[] };
    citationMap?: ResearchCitationMap;
    coverageSummary?: { graph?: Record<string, unknown>; visual?: Record<string, unknown> } | null;
    verificationSummary?: unknown;
    generatedAt: string;
  } | null;
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

const TERMINAL_STATUSES = ["completed", "failed", "cancelled"];

function ProgressStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-[var(--color-text-tertiary)]">{label}</p>
      <p className="mt-0.5 truncate text-sm text-[var(--color-text-primary)]">{value}</p>
    </div>
  );
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
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [exported, setExported] = useState(false);
  // hover/焦点预览卡：键盘 Tab 到引用时同样可见。
  const [hoveredMarker, setHoveredMarker] = useState<{ evidenceId: string; top: number; left: number } | null>(null);
  const reportContainerRef = useRef<HTMLDivElement | null>(null);

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

  const citationIndex = useMemo(() => {
    const index = new Map<string, NonNullable<ResearchCitationMap[string]>[number]>();
    for (const entries of Object.values(run?.reportSnapshot?.citationMap ?? {})) {
      for (const entry of entries) if (!index.has(entry.evidenceId)) index.set(entry.evidenceId, entry);
    }
    return index;
  }, [run?.reportSnapshot?.citationMap]);

  const evidenceById = useMemo(() => new Map((run?.evidence ?? []).map((item) => [item.id, item])), [run?.evidence]);
  const markerByEvidenceId = useMemo(
    () => new Map((run?.reportSnapshot?.reportDocument.evidenceRefs ?? []).map((id, index) => [id, `E${index + 1}`])),
    [run?.reportSnapshot?.reportDocument.evidenceRefs],
  );

  const sources = useMemo(
    () => buildResearchSourceViews({ evidence: (run?.evidence ?? []) as never, relations: run?.sourceRelations ?? [] }),
    [run?.evidence, run?.sourceRelations],
  );
  const progress = useMemo(() => buildResearchProgressSummary({
    questions: run?.questions ?? [],
    tasks: run?.tasks ?? [],
    sourceCount: run?._count.sourceSnapshots ?? 0,
    evidenceCount: run?._count.evidence ?? 0,
    claimCount: run?._count.claims ?? 0,
    graphMetrics: run?.reportSnapshot?.coverageSummary?.graph ?? null,
    visualMetrics: run?.reportSnapshot?.coverageSummary?.visual ?? null,
    metrics: run?.metrics ?? null,
  }), [run]);

  // 用时只在客户端时钟上推进：render 期间不读取 Date.now()，首次写入放在 rAF 回调里。
  const [nowMs, setNowMs] = useState<number | null>(null);
  const activeRunStatus = run?.status;
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setNowMs(Date.now()));
    if (!activeRunStatus || TERMINAL_STATUSES.includes(activeRunStatus)) {
      return () => window.cancelAnimationFrame(frame);
    }
    const timer = window.setInterval(() => setNowMs(Date.now()), 15_000);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(timer);
    };
  }, [activeRunStatus]);
  const elapsed = nowMs === null ? null : formatResearchElapsed(run?.startedAt, run?.completedAt, nowMs);

  function citationFromEvent(event: React.MouseEvent<HTMLDivElement> | React.FocusEvent<HTMLDivElement>): { anchor: HTMLAnchorElement; evidenceId: string } | null {
    const anchor = (event.target as HTMLElement).closest("a");
    if (!(anchor instanceof HTMLAnchorElement)) return null;
    const evidenceId = researchEvidenceIdFromAnchor(anchor.getAttribute("href") ?? "");
    if (!evidenceId) return null;
    return { anchor, evidenceId };
  }

  function handleReportCitationClick(event: React.MouseEvent<HTMLDivElement>) {
    const found = citationFromEvent(event);
    if (!found) return;
    event.preventDefault();
    setSelectedReportEvidenceId(found.evidenceId);
    setHoveredMarker(null);
  }

  function showCitationPreview(event: React.MouseEvent<HTMLDivElement> | React.FocusEvent<HTMLDivElement>) {
    const found = citationFromEvent(event);
    if (!found) return;
    const container = reportContainerRef.current;
    if (!container) return;
    const anchorRect = found.anchor.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    setHoveredMarker({
      evidenceId: found.evidenceId,
      top: anchorRect.bottom - containerRect.top + 8,
      left: Math.max(0, Math.min(anchorRect.left - containerRect.left, containerRect.width - 320)),
    });
  }

  function hideCitationPreview(event: React.MouseEvent<HTMLDivElement> | React.FocusEvent<HTMLDivElement>) {
    const found = citationFromEvent(event);
    if (!found) return;
    setHoveredMarker((current) => (current?.evidenceId === found.evidenceId ? null : current));
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

  async function exportReport() {
    if (!run?.reportSnapshot) return;
    const markdown = buildResearchReportMarkdown({
      title: run.reportSnapshot.reportDocument.title ?? `研究报告：${run.question}`,
      body: run.reportSnapshot.reportDocument.body ?? "",
      bibliography: buildResearchBibliography({
        evidence: (run.evidence ?? []) as never,
        relations: run.sourceRelations ?? [],
      }),
    });
    try {
      await navigator.clipboard.writeText(markdown);
      setExported(true);
      window.setTimeout(() => setExported(false), 2_000);
    } catch {
      setExported(false);
    }
  }

  if (workspaceQuery.isPending) return <main className="flex h-full items-center justify-center text-sm text-[var(--color-text-tertiary)]">正在加载研究工作区…</main>;
  if (workspaceQuery.isError || !workspace) {
    return (
      <main className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <p role="alert" className="text-sm text-[var(--color-danger)]">研究工作区加载失败，请稍后重试。</p>
        <Button type="button" variant="secondary" size="sm" onClick={() => workspaceQuery.refetch()}>重新加载</Button>
      </main>
    );
  }

  const stageLabel = run?.stage?.label ?? run?.status;
  const hasReport = Boolean(run?.reportSnapshot);
  const hoveredCitation = hoveredMarker ? citationIndex.get(hoveredMarker.evidenceId) : undefined;

  return (
    <main className="h-full overflow-y-auto bg-[var(--color-bg)]">
      <div className="mx-auto max-w-6xl px-5 py-6 sm:px-8 sm:py-8">
        <Link href="/research" className="inline-flex items-center gap-1 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"><ArrowLeft width={14} height={14} />深度研究</Link>
        <div className="mt-5 flex items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">{workspace.name}</h1><p className="mt-1 text-sm text-[var(--color-text-secondary)]">{workspace.project?.name ? `关联项目：${workspace.project.name}` : "独立研究上下文"}</p></div><BrainResearch className="text-[var(--color-accent)]" width={26} height={26} strokeWidth={1.5} /></div>

        <form onSubmit={createRun} className="mt-8 flex max-w-3xl flex-wrap gap-2">
          <textarea value={question} onChange={(event) => setQuestion(event.target.value)} rows={2} placeholder="输入研究问题，例如：比较两种方法在近五年公开证据中的适用边界" className="min-h-20 min-w-0 flex-1 resize-y rounded-[var(--radius-md)] bg-[var(--color-panel)] px-3 py-2 text-sm leading-6 text-[var(--color-text-primary)] outline-none ring-1 ring-transparent placeholder:text-[var(--color-text-tertiary)] focus:ring-[var(--color-accent)]" />
          <Select value={budgetProfile} onValueChange={(value) => setBudgetProfile(value as "quick" | "deep" | "comprehensive")}>
            <SelectTrigger aria-label="本次研究预算配置" className="min-h-10 bg-[var(--color-panel)] px-2.5 text-xs text-[var(--color-text-secondary)]"><SelectValue placeholder="选择研究强度" /></SelectTrigger>
            <SelectContent position="popper" align="start"><SelectGroup><SelectLabel>研究强度</SelectLabel><SelectItem value="quick">Quick · 快速</SelectItem><SelectItem value="deep">Deep · 深入</SelectItem><SelectItem value="comprehensive">Comprehensive · 全面</SelectItem></SelectGroup></SelectContent>
          </Select>
          <Button type="submit" variant="primary" size="sm" className="self-end" disabled={createRunMutation.isPending}>开始规划</Button>
        </form>

        <div className="mt-8 grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
          <aside aria-label="研究运行历史">
            <p className="mb-2 px-1 text-xs text-[var(--color-text-tertiary)]">研究运行</p>
            <div className="space-y-1">
              {workspace.runs.map((item) => (
                <button key={item.id} type="button" aria-current={activeRunId === item.id ? "true" : undefined} onClick={() => setSelectedRunId(item.id)} className={`block w-full rounded-[var(--radius-md)] px-3 py-3 text-left ${activeRunId === item.id ? "bg-[var(--color-interaction-selected)] text-[var(--color-text-primary)]" : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"}`}>
                  <span className="block truncate text-xs font-medium">{item.question}</span>
                  <span className="mt-1 block text-[11px] text-[var(--color-text-tertiary)]">{item.status}</span>
                </button>
              ))}
            </div>
          </aside>

          <section className="min-w-0">
            {runQuery.isError ? (
              <div className="py-20 text-center">
                <p role="alert" className="text-sm text-[var(--color-danger)]">这次 Research Run 加载失败，请稍后重试。</p>
                <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={() => runQuery.refetch()}>重新加载</Button>
              </div>
            ) : runQuery.isPending && !run ? (
              <div aria-busy="true" className="py-20 text-center text-sm text-[var(--color-text-tertiary)]">正在加载研究运行…</div>
            ) : !run ? (
              <div className="py-20 text-center text-sm text-[var(--color-text-tertiary)]">选择一次运行，查看计划、报告与公开进度。</div>
            ) : <>
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded-full bg-[var(--color-interaction-selected)] px-3 py-1 text-xs text-[var(--color-accent)]" data-stage={run.stage?.key ?? run.status}>{stageLabel}</span>
                {elapsed ? <span className="text-xs text-[var(--color-text-tertiary)]">用时 {elapsed}</span> : null}
                <span className="ml-auto text-xs text-[var(--color-text-tertiary)]">{run._count.sourceSnapshots} 来源 · {run._count.evidence} Evidence · {run._count.claims} Claim</span>
                {!TERMINAL_STATUSES.includes(run.status) ? <Button type="button" variant="ghost" size="sm" onClick={() => setCancelDialogOpen(true)} disabled={cancelRun.isPending}>取消运行</Button> : null}
                {hasReport ? (
                  <Button type="button" variant="secondary" size="sm" onClick={exportReport}>
                    {exported ? <Check width={14} height={14} /> : <Copy width={14} height={14} />}{exported ? "已复制 Markdown" : "复制报告 Markdown"}
                  </Button>
                ) : null}
              </div>
              <p aria-live="polite" role="status" className="mt-2 min-h-5 text-xs text-[var(--color-text-secondary)]">{liveMessage}</p>

              {run.degradations && run.degradations.length > 0 ? (
                <div role="status" className="mt-4 space-y-1 bg-[var(--color-info-muted)] px-4 py-3">
                  {run.degradations.map((item) => (
                    <p key={item.code} className="text-xs leading-5 text-[var(--color-warning)]">{item.message}</p>
                  ))}
                </div>
              ) : null}

              {run.status === "failed" ? (
                <div role="alert" className="mt-4 bg-[var(--color-info-muted)] px-4 py-3">
                  <p className="text-xs leading-5 text-[var(--color-danger)]">本次研究未能完成{run.failureReason ? `：${run.failureReason}` : "。"}已保存的来源、Evidence 与 Claim 仍可查看，也可以创建 Follow-up Run 继续。</p>
                </div>
              ) : null}

              {run.status === "cancelled" ? (
                <div className="mt-4 bg-[var(--color-panel)] px-4 py-3"><p className="text-xs leading-5 text-[var(--color-text-secondary)]">这次研究已被取消，已保存的研究资产仍然保留。</p></div>
              ) : null}

              <AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>取消 Research Run</AlertDialogTitle>
                    <AlertDialogDescription>确定取消这次 Research Run 吗？已保存的研究资产不会删除。</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>继续研究</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" disabled={cancelRun.isPending} onClick={() => { cancelRun.mutate(); setCancelDialogOpen(false); }}>取消运行</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              <div className="mt-5 bg-[var(--color-panel)] px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">进度摘要</h2>
                  <span className="text-xs text-[var(--color-text-tertiary)]">仅公开状态与计数，不含隐藏推理</span>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  <ProgressStat label="Research Questions" value={`${progress.questionsResolved}/${progress.questionTotal} 已解决`} />
                  <ProgressStat label="待处理任务" value={String(progress.activeTasks)} />
                  <ProgressStat label="已读取来源" value={String(progress.sourceCount)} />
                  <ProgressStat label="Evidence" value={String(progress.evidenceCount)} />
                  <ProgressStat label="Claim" value={String(progress.claimCount)} />
                  <ProgressStat label="引用图扩展" value={progress.citationExpansionEdges > 0 ? `${progress.citationExpansionEdges} 条边 · ${progress.citationExpansionSources} 个来源` : "本次未发生"} />
                  <ProgressStat label="图表视觉证据" value={progress.visualObservations > 0 ? `${progress.visualObservations} 条观察` : "本次未使用"} />
                  <ProgressStat label="检索 / 读取 / 模型" value={`${progress.searchCalls} / ${progress.fetchCalls} / ${progress.modelCalls}`} />
                </div>
              </div>

              {hasReport ? (
                <section aria-label="研究报告" className="mt-5 bg-[var(--color-panel)] px-5 py-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">{run.reportSnapshot?.reportDocument.title ?? `研究报告：${run.question}`}</h2>
                    <span className="text-xs text-[var(--color-text-tertiary)]">不可修改快照 · {new Date(run.reportSnapshot!.generatedAt).toLocaleString("zh-CN")}</span>
                  </div>
                  <div className="mt-5 grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
                    <div className="relative min-w-0">
                      <div
                        ref={reportContainerRef}
                        className="relative"
                        onClick={handleReportCitationClick}
                        onMouseOver={showCitationPreview}
                        onMouseOut={hideCitationPreview}
                        onFocus={showCitationPreview}
                        onBlur={hideCitationPreview}
                      >
                        <MarkdownContent content={reportBody} />
                      </div>
                      {hoveredMarker && hoveredCitation ? (
                        <div role="tooltip" className="pointer-events-none absolute z-20 w-80 rounded-[var(--radius-md)] bg-[var(--color-bg)] px-4 py-3 shadow-lg" style={{ top: hoveredMarker.top, left: hoveredMarker.left }}>
                          <ResearchCitationCard entry={hoveredCitation} evidence={evidenceById.get(hoveredMarker.evidenceId)} marker={markerByEvidenceId.get(hoveredMarker.evidenceId)} className="" />
                        </div>
                      ) : null}
                    </div>
                    <ResearchReportEvidencePanel
                      claims={run.claims}
                      evidence={run.evidence as never}
                      citationMap={run.reportSnapshot?.citationMap}
                      evidenceRefs={run.reportSnapshot?.reportDocument.evidenceRefs ?? []}
                      selectedEvidenceId={selectedReportEvidenceId}
                      onSelectEvidence={setSelectedReportEvidenceId}
                    />
                  </div>
                </section>
              ) : null}

              {TERMINAL_STATUSES.includes(run.status) ? (
                <section className="mt-5 bg-[var(--color-panel)] px-5 py-5">
                  <h2 className="text-base font-semibold text-[var(--color-text-primary)]">继续研究</h2>
                  <p className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">创建新的 Follow-up Run；当前 Run、Plan 和 Report 保持不可修改，并继承已有研究资产作为待重新评估的上下文。</p>
                  <form className="mt-4 flex flex-wrap gap-2" onSubmit={createFollowUpRun}>
                    <input value={followUpQuestion} onChange={(event) => setFollowUpQuestion(event.target.value)} required minLength={3} placeholder="例如：补充反方证据，或更新到最近一年" className="min-w-0 flex-1 rounded-[var(--radius-md)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none ring-1 ring-transparent placeholder:text-[var(--color-text-tertiary)] focus:ring-[var(--color-accent)]" />
                    <Button type="submit" variant="secondary" size="sm" disabled={createFollowUp.isPending}>创建 Follow-up Run</Button>
                  </form>
                </section>
              ) : null}

              {plan ? (
                <div className="mt-5 space-y-5">
                  <div className="bg-[var(--color-panel)] px-5 py-5">
                    <h2 className="text-base font-semibold text-[var(--color-text-primary)]">研究计划</h2>
                    <p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">{plan.scope}</p>
                    <div className="mt-5 grid gap-4 sm:grid-cols-3">
                      <ProgressStat label="研究目标" value={plan.researchGoal} />
                      <ProgressStat label="研究强度" value={plan.researchIntensity} />
                      <ProgressStat label="时间范围" value={plan.timeRange ?? "未限定"} />
                      <ProgressStat label="领域 Profile" value={plan.domainProfile?.name ?? "通用研究"} />
                    </div>
                    <div className="mt-5 grid gap-5 sm:grid-cols-2">
                      <div><p className="text-xs text-[var(--color-text-tertiary)]">来源策略</p><ul className="mt-2 space-y-1 text-sm leading-6 text-[var(--color-text-secondary)]">{plan.sourceStrategy.map((item) => <li key={item}>· {item}</li>)}</ul></div>
                      <div><p className="text-xs text-[var(--color-text-tertiary)]">预期产出</p><ul className="mt-2 space-y-1 text-sm leading-6 text-[var(--color-text-secondary)]">{plan.expectedOutputs.map((item) => <li key={item}>· {item}</li>)}</ul></div>
                    </div>
                    <div className="mt-5"><p className="text-xs text-[var(--color-text-tertiary)]">完成标准</p><ul className="mt-2 space-y-1 text-sm leading-6 text-[var(--color-text-secondary)]">{plan.completionCriteria.map((item) => <li key={item}>· {item}</li>)}</ul></div>
                    <div className="mt-5">
                      <p className="text-xs text-[var(--color-text-tertiary)]">Research Questions</p>
                      <div className="mt-2 space-y-2">
                        {run.questions.map((item) => (
                          <div key={item.id} className="flex items-start gap-3 rounded-[var(--radius-md)] bg-[var(--color-bg)] px-3 py-2">
                            <span className="mt-0.5 shrink-0 text-[11px] text-[var(--color-text-tertiary)]">{item.priority}</span>
                            <span className="min-w-0 flex-1 text-sm leading-6 text-[var(--color-text-secondary)]">{item.title}<span className="mt-1 block text-[11px] leading-5 text-[var(--color-text-tertiary)]">{item.question}</span></span>
                            <span className="shrink-0 text-[11px] text-[var(--color-text-tertiary)]">{item.status}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    {run.status === "awaiting_confirmation" ? (
                      <div className="mt-5 flex flex-wrap items-center gap-2">
                        <Button type="button" variant="primary" size="sm" onClick={() => confirmPlan.mutate(undefined)} disabled={confirmPlan.isPending}><Check width={16} height={16} />确认计划并开始研究</Button>
                        <input value={planDirective} onChange={(event) => setPlanDirective(event.target.value)} placeholder="可选：先调整计划，例如缩小范围或补充来源" className="min-w-0 flex-1 rounded-[var(--radius-md)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none ring-1 ring-transparent placeholder:text-[var(--color-text-tertiary)] focus:ring-[var(--color-accent)]" />
                        <Button type="button" variant="secondary" size="sm" onClick={() => revisePlan.mutate(planDirective.trim(), { onSuccess: () => setPlanDirective("") })} disabled={revisePlan.isPending || !planDirective.trim()}>提交调整</Button>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {run.status === "awaiting_scope_confirmation" ? (
                <div className="mt-5 bg-[var(--color-info-muted)] px-5 py-5">
                  <h2 className="text-base font-semibold text-[var(--color-text-primary)]">确认扩大范围后继续</h2>
                  <p className="mt-1 text-sm leading-6 text-[var(--color-text-secondary)]">当前 Durable Execution 已暂停在队列中；确认后会复用同一个执行记录继续，不会创建第二套 Worker。</p>
                  <div className="mt-4 space-y-2">{run.directives.filter((item) => item.status === "needs_confirmation").map((item) => <div key={item.id} className="text-sm text-[var(--color-text-primary)]">{item.text}<span className="ml-2 text-xs text-[var(--color-text-tertiary)]">{item.impact === "budget_expansion" ? "预算扩大" : "范围扩大"}</span></div>)}</div>
                  <div className="mt-5 flex flex-wrap items-center gap-2">
                    <Button type="button" variant="primary" size="sm" onClick={() => confirmScope.mutate({ approved: true, ...(run.directives.some((item) => item.impact === "budget_expansion") ? { budgetProfile: scopeBudget } : {}) })} disabled={confirmScope.isPending}><Check width={16} height={16} />确认并继续</Button>
                    <Button type="button" variant="secondary" size="sm" onClick={() => confirmScope.mutate({ approved: false })} disabled={confirmScope.isPending}>拒绝扩大，继续原计划</Button>
                    {run.directives.some((item) => item.impact === "budget_expansion") ? (
                      <Select value={scopeBudget} onValueChange={(value) => setScopeBudget(value as "deep" | "comprehensive")}>
                        <SelectTrigger aria-label="范围扩大后的预算配置" size="sm" className="min-w-36 bg-[var(--color-bg)] text-sm text-[var(--color-text-primary)]"><SelectValue /></SelectTrigger>
                        <SelectContent position="popper" align="start"><SelectGroup><SelectLabel>预算配置</SelectLabel><SelectItem value="deep">Deep 预算</SelectItem><SelectItem value="comprehensive">Comprehensive 预算</SelectItem></SelectGroup></SelectContent>
                      </Select>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {run.budgetSnapshot ? (
                <div className="mt-5 bg-[var(--color-panel)] px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold text-[var(--color-text-primary)]">预算状态</h2><span className="text-xs text-[var(--color-text-tertiary)]">{run.budgetSnapshot.profile}</span></div>
                  {(() => {
                    const counters = liveBudget?.runId === run.id ? liveBudget.counters : run.metrics ?? {};
                    return <div className="mt-3 grid gap-3 text-xs text-[var(--color-text-secondary)] sm:grid-cols-3"><span>模型调用 {counters.modelCalls ?? 0}/{run.budgetSnapshot!.modelCalls}</span><span>检索 {counters.searchCalls ?? 0}/{run.budgetSnapshot!.searchCalls}</span><span>读取 {counters.fetchCalls ?? 0}/{run.budgetSnapshot!.fetchCalls}</span><span>来源 {counters.sourceCount ?? run._count.sourceSnapshots}/{run.budgetSnapshot!.maxSources}</span><span>Token {counters.totalTokens ?? 0}/{run.budgetSnapshot!.maxTokens}</span><span>Repair {counters.verificationRepairs ?? 0}/{run.budgetSnapshot!.maxVerificationRepairs}</span></div>;
                  })()}
                </div>
              ) : null}

              <div className="mt-5 grid gap-5 xl:grid-cols-2">
                <div className="bg-[var(--color-panel)] px-5 py-5">
                  <h2 className="text-base font-semibold text-[var(--color-text-primary)]">Question 完成度</h2>
                  <div className="mt-3 space-y-3">
                    {run.questions.map((item) => {
                      const completion = researchQuestionCompletion(item.status);
                      return (
                        <div key={item.id}>
                          <div className="flex items-center justify-between gap-3 text-xs"><span className="truncate text-[var(--color-text-secondary)]">{item.title}</span><span className="shrink-0 text-[var(--color-text-tertiary)]">{completion}% · {item.status}</span></div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-hover)]"><div className="h-full rounded-full bg-[var(--color-accent)] transition-[width]" style={{ width: `${completion}%` }} /></div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="bg-[var(--color-panel)] px-5 py-5">
                  <h2 className="text-base font-semibold text-[var(--color-text-primary)]">当前任务</h2>
                  <div className="mt-3 space-y-2">
                    {run.tasks.filter((task) => ["running", "retrying", "pending"].includes(task.status)).slice(0, 8).map((task) => (
                      <div key={task.id} className="flex items-center justify-between gap-3 text-sm"><span className="truncate text-[var(--color-text-secondary)]">{task.title}</span><span className="shrink-0 text-xs text-[var(--color-text-tertiary)]">{task.status}</span></div>
                    ))}
                    {run.tasks.every((task) => !["running", "retrying", "pending"].includes(task.status)) ? <p className="text-xs text-[var(--color-text-tertiary)]">当前没有待处理任务。</p> : null}
                  </div>
                </div>
              </div>

              <div className="mt-5 bg-[var(--color-panel)] px-5 py-5">
                <h2 className="text-base font-semibold text-[var(--color-text-primary)]">追加研究方向</h2>
                <p className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">普通调整会在后续评估中吸收；明显扩大范围或预算会暂停并等待确认。</p>
                <form className="mt-3 flex gap-2" onSubmit={(event) => { event.preventDefault(); if (!directive.trim()) return; appendDirective.mutate(directive.trim(), { onSuccess: () => setDirective("") }); }}>
                  <input value={directive} onChange={(event) => setDirective(event.target.value)} placeholder="例如：补充近三年的官方数据" className="min-w-0 flex-1 rounded-[var(--radius-md)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none ring-1 ring-transparent placeholder:text-[var(--color-text-tertiary)] focus:ring-[var(--color-accent)]" />
                  <Button type="submit" variant="secondary" size="sm" disabled={appendDirective.isPending}>追加</Button>
                </form>
              </div>

              <div className="mt-5"><ResearchSourcesPanel sources={sources} selectedSourceId={selectedSourceId} onSelectSource={setSelectedSourceId} /></div>
              <ResearchEvidencePanel runId={run.id} workspaceId={workspaceId} evidence={run.evidence as never} />
              <ResearchClaimsPanel runId={run.id} workspaceId={workspaceId} claims={run.claims} evidence={run.evidence as never} />

              <div className="mt-5 bg-[var(--color-panel)] px-5 py-5">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-base font-semibold text-[var(--color-text-primary)]">公开执行事件</h2>
                  <span className="text-xs text-[var(--color-text-tertiary)]">仅显示公开状态、检索词和来源，不含隐藏推理</span>
                </div>
                <div className="mt-3 max-h-80 space-y-2 overflow-y-auto">
                  {visiblePublicEvents.length === 0 ? <p className="text-xs text-[var(--color-text-tertiary)]">运行期间这里会显示公开进度事件；刷新后仍可从报告与来源面板查看结果。</p> : visiblePublicEvents.map((event, index) => (
                    <div key={`${event.createdAt ?? "event"}-${index}`} className="rounded-[var(--radius-sm)] bg-[var(--color-bg)] px-3 py-2 text-xs">
                      <div className="flex items-start justify-between gap-3">
                        <p className="leading-5 text-[var(--color-text-secondary)]">{event.message ?? event.kind ?? "研究事件"}</p>
                        {event.createdAt ? <time className="shrink-0 text-[10px] text-[var(--color-text-tertiary)]">{new Date(event.createdAt).toLocaleTimeString("zh-CN")}</time> : null}
                      </div>
                      {event.publicData?.queries?.length ? <p className="mt-1 text-[11px] text-[var(--color-accent)]">检索词：{event.publicData.queries.join(" · ")}</p> : null}
                      {event.publicData?.query ? <p className="mt-1 text-[11px] text-[var(--color-accent)]">检索词：{event.publicData.query}</p> : null}
                      {event.publicData?.provider ? <p className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">Provider：{event.publicData.provider}{event.publicData.snapshotId ? ` · Snapshot ${event.publicData.snapshotId.slice(0, 10)}` : ""}</p> : null}
                    </div>
                  ))}
                </div>
              </div>

              <ResearchPaperTransferPanel runId={run.id} workspaceId={workspaceId} />
            </>}
          </section>
        </div>
      </div>
    </main>
  );
}
