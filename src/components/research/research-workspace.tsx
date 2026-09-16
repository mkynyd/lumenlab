"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, BrainResearch, Copy, Expand, List, Page, Check } from "iconoir-react";
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
import { ResearchComposer, type ResearchComposerOptions } from "@/components/research/research-composer";
import { ResearchPlanReviewCard } from "@/components/research/research-plan-review-card";
import { ResearchEvidencePanel } from "@/components/research/research-evidence-panel";
import { ResearchClaimsPanel } from "@/components/research/research-claims-panel";
import { ResearchPaperTransferPanel } from "@/components/research/research-paper-transfer-panel";
import { ResearchSourcesPanel } from "@/components/research/research-sources-panel";
import { ResearchActivityPanel } from "@/components/research/research-activity-panel";
import { ResearchReportReader } from "@/components/research/research-report-reader";
import { fetchJson } from "@/lib/api/client";
import { MODEL_CATALOG_ENTRIES } from "@/lib/chat/model-catalog";
import type { FileAttachment } from "@/lib/chat/router";
import { uploadResearchAttachments, type ResearchAttachmentState } from "@/lib/hooks/use-research-launch";
import { useAppendResearchDirective, useCancelResearchRun, useConfirmResearchPlan, useConfirmResearchScope, useCreateResearchFollowUp, useCreateResearchRun, useResearchRun, useResearchWorkspace, useReviseResearchPlan, useUpdateResearchWorkspace } from "@/lib/hooks/use-research";
import { buildResearchReportMarkdown, buildResearchBibliography, linkifyResearchEvidenceMarkers } from "@/lib/research/report-citations";
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
  commanderModel?: string | null;
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
    reportDocument: { body?: string; title?: string; evidenceRefs?: string[]; qualityState?: "normal" | "degraded" };
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
  originalRequest?: string;
  objective?: string;
  intentType?: string;
  targetTimeRange?: string | null;
  evidenceTimeRange?: string | null;
  scopeInclusions?: string[];
  scopeExclusions?: string[];
  assumptions?: string[];
  evaluationDimensions?: string[];
  expectedOutput?: string;
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

function PlanningSkeleton() {
  return (
    <div aria-busy="true" className="mt-5 rounded-[var(--radius-lg)] bg-[var(--color-panel-muted)] px-5 py-5 sm:px-7 sm:py-6">
      <div className="flex items-center gap-2.5">
        <span className="size-4 animate-spin rounded-full border-2 border-[var(--color-border-light)] border-t-[var(--color-accent)]" />
        <p className="text-sm font-medium text-[var(--color-text-primary)]">正在生成研究计划</p>
      </div>
      <p className="mt-1.5 text-xs text-[var(--color-text-tertiary)]">系统正在拆解研究问题、规划来源策略，通常需要几秒到几十秒。</p>
      <div className="mt-5 space-y-2.5">
        <div className="h-3.5 w-2/5 animate-pulse rounded-full bg-[var(--color-panel-muted)]" />
        <div className="h-3.5 w-3/5 animate-pulse rounded-full bg-[var(--color-panel-muted)]" />
        <div className="h-3.5 w-1/2 animate-pulse rounded-full bg-[var(--color-panel-muted)]" />
        <div className="h-3.5 w-4/6 animate-pulse rounded-full bg-[var(--color-panel-muted)]" />
      </div>
    </div>
  );
}

export function ResearchWorkspaceView({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlRunId = searchParams.get("run");
  const workspaceQuery = useResearchWorkspace(workspaceId);
  const workspace = workspaceQuery.data as { id: string; name: string; project?: { id: string; name: string } | null; runs: Array<{ id: string; question: string; status: string; createdAt: string }> } | undefined;
  // 选中 run：初始与外部导航取 URL ?run=，用户点击后走本地选择并 router.replace 写回。
  const [chosenRunId, setChosenRunId] = useState<string | null>(null);
  const selectedRunId = chosenRunId ?? urlRunId;
  const activeRunId = selectedRunId ?? workspace?.runs[0]?.id ?? null;
  const createRunMutation = useCreateResearchRun(workspaceId);
  const updateWorkspace = useUpdateResearchWorkspace(workspaceId);
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
  const [followUpQuestion, setFollowUpQuestion] = useState("");
  const [composerError, setComposerError] = useState<string | null>(null);
  const [composerNotice, setComposerNotice] = useState<string | null>(null);
  const [composerUploads, setComposerUploads] = useState<ResearchAttachmentState[]>([]);
  const [liveMessage, setLiveMessage] = useState("");
  const [liveBudget, setLiveBudget] = useState<{ runId: string; counters: ResearchBudgetCounters } | null>(null);
  const [publicEvents, setPublicEvents] = useState<ResearchPublicEvent[]>([]);
  const [publicEventsRunId, setPublicEventsRunId] = useState<string | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(true);
  const [readerOpen, setReaderOpen] = useState(false);
  const [exported, setExported] = useState(false);

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

  function selectRun(id: string) {
    setChosenRunId(id);
    router.replace(`/research/${workspaceId}?run=${id}`, { scroll: false });
  }

  async function sendFromComposer(question: string, attachments: FileAttachment[], options: ResearchComposerOptions): Promise<boolean> {
    const trimmed = question.trim();
    if (trimmed.length < 3) return false;
    setComposerError(null);
    setComposerNotice(null);
    setComposerUploads([]);
    try {
      if (attachments.length > 0) {
        let projectId = workspace?.project?.id ?? null;
        if (!projectId) {
          const project = (
            await fetchJson<{ project: { id: string } }>("/api/projects", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: `${trimmed.slice(0, 30)} · 研究资料`, type: "general" }),
            })
          ).project;
          await updateWorkspace.mutateAsync({ projectId: project.id });
          projectId = project.id;
        }
        setComposerUploads(attachments.map((attachment) => ({ id: attachment.id, name: attachment.name, status: "uploading" as const })));
        const failedCount = await uploadResearchAttachments(projectId, attachments, (id, status, fileError) => {
          setComposerUploads((current) => current.map((item) => (item.id === id ? { ...item, status, error: fileError } : item)));
        });
        if (failedCount === attachments.length) {
          setComposerNotice("所有附件上传失败，本次研究将不包含附件。");
        } else if (failedCount > 0) {
          setComposerNotice(`${failedCount} 个附件上传失败，已使用其余附件继续。`);
        }
      }
      const created = (await createRunMutation.mutateAsync({
        question: trimmed,
        budgetProfile: options.budgetProfile,
        commanderModel: options.commanderModel,
      })) as { id: string };
      selectRun(created.id);
      return true;
    } catch (caught) {
      setComposerError(caught instanceof Error ? caught.message : "研究创建失败，请重试");
      return false;
    }
  }

  async function createFollowUpRun(event: React.FormEvent) {
    event.preventDefault();
    if (!followUpQuestion.trim()) return;
    const created = await createFollowUp.mutateAsync(followUpQuestion.trim());
    setFollowUpQuestion("");
    selectRun(created.id);
  }

  async function exportReport() {
    if (!run?.reportSnapshot) return;
    const markdown = buildResearchReportMarkdown({
      title: run.reportSnapshot.reportDocument.title ?? `研究报告：${run.question}`,
      body: run.reportSnapshot.reportDocument.body ?? "",
      bibliography: buildResearchBibliography({
        evidence: (run.evidence ?? []) as never,
        relations: run.sourceRelations ?? [],
        citedEvidenceIds: run.reportSnapshot.reportDocument.evidenceRefs ?? [],
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
  const isTerminal = run ? TERMINAL_STATUSES.includes(run.status) : false;
  const isWorking = run ? !isTerminal && !["planning", "awaiting_confirmation", "awaiting_scope_confirmation"].includes(run.status) : false;
  const commanderLabel = run?.commanderModel
    ? MODEL_CATALOG_ENTRIES.find((entry) => entry.id === run.commanderModel)?.displayName ?? run.commanderModel
    : null;
  const overallProgress = run?.questions.length
    ? Math.round(run.questions.reduce((sum, question) => sum + researchQuestionCompletion(question.status), 0) / run.questions.length)
    : 0;
  const reportTitle = run?.reportSnapshot?.reportDocument.title ?? (run ? `研究报告：${run.question}` : "");
  const citationCount = run?.reportSnapshot?.reportDocument.evidenceRefs?.length ?? 0;

  const publicEventsPanel = (
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
  );

  const directivePanel = (
    <div className="mt-5 bg-[var(--color-panel)] px-5 py-5">
      <h2 className="text-base font-semibold text-[var(--color-text-primary)]">追加研究方向</h2>
      <p className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">普通调整会在后续评估中吸收；明显扩大范围或预算会暂停并等待确认。</p>
      <form className="mt-3 flex gap-2" onSubmit={(event) => { event.preventDefault(); if (!directive.trim()) return; appendDirective.mutate(directive.trim(), { onSuccess: () => setDirective("") }); }}>
        <input value={directive} onChange={(event) => setDirective(event.target.value)} placeholder="例如：补充近三年的官方数据" className="min-w-0 flex-1 rounded-[var(--radius-md)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none ring-1 ring-transparent placeholder:text-[var(--color-text-tertiary)] focus:ring-[var(--color-accent)]" />
        <Button type="submit" variant="secondary" size="sm" disabled={appendDirective.isPending}>追加</Button>
      </form>
    </div>
  );

  const followUpPanel = (
    <section className="mt-5 bg-[var(--color-panel)] px-5 py-5">
      <h2 className="text-base font-semibold text-[var(--color-text-primary)]">继续研究</h2>
      <p className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">创建新的 Follow-up Run；当前 Run、Plan 和 Report 保持不可修改，并继承已有研究资产作为待重新评估的上下文。</p>
      <form className="mt-4 flex flex-wrap gap-2" onSubmit={createFollowUpRun}>
        <input value={followUpQuestion} onChange={(event) => setFollowUpQuestion(event.target.value)} required minLength={3} placeholder="例如：补充反方证据，或更新到最近一年" className="min-w-0 flex-1 rounded-[var(--radius-md)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none ring-1 ring-transparent placeholder:text-[var(--color-text-tertiary)] focus:ring-[var(--color-accent)]" />
        <Button type="submit" variant="secondary" size="sm" disabled={createFollowUp.isPending}>创建 Follow-up Run</Button>
      </form>
    </section>
  );

  return (
    <main className="h-full w-full min-w-0 overflow-x-clip overflow-y-auto bg-[var(--color-bg)]">
      <div className={`mx-auto w-full min-w-0 max-w-[90rem] px-5 py-5 transition-[padding] duration-300 sm:px-8 sm:py-6 ${activityOpen && isWorking ? "xl:pr-[23rem]" : ""}`}>
        <header className="flex items-center gap-3">
          <Link href="/research" aria-label="返回深度研究" className="inline-flex size-8 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"><ArrowLeft width={16} height={16} /></Link>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold text-[var(--color-text-primary)]">{workspace.name}</h1>
            <p className="mt-0.5 truncate text-[11px] text-[var(--color-text-tertiary)]">{workspace.project?.name ? `关联项目：${workspace.project.name}` : "深度研究"}</p>
          </div>
          <BrainResearch className="text-[var(--color-accent)]" width={20} height={20} strokeWidth={1.5} />
        </header>

        {workspace.runs.length > 1 ? (
          <nav aria-label="研究运行历史" className="mt-5 flex gap-1 overflow-x-auto pb-1">
              {workspace.runs.map((item) => (
                <button key={item.id} type="button" aria-current={activeRunId === item.id ? "true" : undefined} onClick={() => selectRun(item.id)} className={`shrink-0 rounded-full px-3 py-1.5 text-xs ${activeRunId === item.id ? "bg-[var(--color-interaction-selected)] text-[var(--color-text-primary)]" : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"}`}>
                  <span className="max-w-52 truncate">{item.question}</span>
                </button>
              ))}
          </nav>
        ) : null}

        <div className="mx-auto mt-8 w-full max-w-4xl">
          {run ? (
            <div className="ml-auto max-w-3xl rounded-[var(--radius-lg)] bg-[var(--color-accent-muted)] px-5 py-4 sm:px-6">
              <p className="text-[11px] font-medium text-[var(--color-accent)]">深度研究</p>
              <p className="mt-1 text-sm leading-6 text-[var(--color-text-primary)]">{run.question}</p>
            </div>
          ) : null}

          <section className="mt-7 min-w-0">
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
              <div className="flex flex-wrap items-center gap-3 px-1">
                <span className="rounded-full bg-[var(--color-interaction-selected)] px-3 py-1 text-xs text-[var(--color-accent)]" data-stage={run.stage?.key ?? run.status}>{stageLabel}</span>
                {elapsed ? <span className="text-xs text-[var(--color-text-tertiary)]">用时 {elapsed}</span> : null}
                {commanderLabel ? <span className="text-xs text-[var(--color-text-tertiary)]">指挥模型 {commanderLabel}</span> : null}
              </div>
              {!isTerminal ? (
                <p aria-live="polite" role="status" className="mt-2 min-h-5 px-1 text-xs text-[var(--color-text-secondary)]">{liveMessage}</p>
              ) : null}

              {run.degradations && run.degradations.length > 0 ? (
                <div role="status" className="mt-4 space-y-1 bg-[var(--color-info-muted)] px-4 py-3">
                  {run.degradations.map((item) => (
                    <p key={item.code} className="text-xs leading-5 text-[var(--color-warning)]">{item.message}</p>
                  ))}
                </div>
              ) : null}

              {run.reportSnapshot?.reportDocument.qualityState === "degraded" ? (
                <div role="alert" className="mt-4 bg-[var(--color-info-muted)] px-4 py-3">
                  <p className="text-xs leading-5 text-[var(--color-warning)]">研究资料已经保存，但最终综合或质量审计未完整通过。本页不会把诊断性证据摘要伪装成正常高质量报告。</p>
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

              {run.status === "planning" ? <PlanningSkeleton /> : null}

              {run.status === "awaiting_confirmation" && plan ? (
                <div className="mt-5">
                  <ResearchPlanReviewCard
                    plan={plan}
                    questions={run.questions}
                    showActions
                    confirming={confirmPlan.isPending}
                    revising={revisePlan.isPending}
                    onConfirm={() => confirmPlan.mutate(undefined)}
                    onRevise={(text) => revisePlan.mutate(text)}
                    onCancel={() => setCancelDialogOpen(true)}
                  />
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

              {isWorking ? (
                <>
                  <div className="mt-5 rounded-[var(--radius-lg)] bg-[var(--color-panel-muted)] px-5 py-5 sm:px-7 sm:py-6">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">正在研究</p>
                        <h2 className="mt-1 text-lg font-semibold text-[var(--color-text-primary)]">{plan?.objective ?? run.question}</h2>
                      </div>
                      <Button type="button" variant="ghost" size="sm" aria-expanded={activityOpen} onClick={() => setActivityOpen((open) => !open)}>
                        <List width={14} height={14} />{activityOpen ? "收起活动" : "研究活动"}
                      </Button>
                    </div>

                    <ol className="mt-5 space-y-1">
                      {run.questions.map((item) => {
                        const completion = researchQuestionCompletion(item.status);
                        return (
                          <li key={item.id} className="flex items-center gap-3 rounded-[var(--radius-md)] px-2 py-2.5" title={completion === 100 ? `${item.title} · 已完成` : completion > 0 ? `${item.title} · 正在处理` : `${item.title} · 等待开始`}>
                            {completion === 100 ? (
                              <span className="inline-flex size-[18px] shrink-0 items-center justify-center rounded-full bg-[var(--color-text-primary)] text-[var(--color-bg)]" aria-hidden="true">
                                <Check width={12} height={12} />
                              </span>
                            ) : completion > 0 ? (
                              <span className="inline-flex size-[18px] shrink-0 rounded-full border-2 border-[var(--color-text-primary)]" aria-hidden="true" />
                            ) : (
                              <span className="inline-flex size-[18px] shrink-0 rounded-full border border-dashed border-[var(--color-text-tertiary)]" aria-hidden="true" />
                            )}
                            <span className={`min-w-0 flex-1 truncate text-sm leading-6 ${completion === 100 ? "text-[var(--color-text-primary)]" : completion > 0 ? "text-[var(--color-text-primary)]" : "text-[var(--color-text-secondary)]"}`}>{item.title}</span>
                          </li>
                        );
                      })}
                    </ol>

                    <div className="mt-6 flex items-center justify-between gap-4 text-xs text-[var(--color-text-tertiary)]">
                      <span className="min-w-0 truncate">{liveMessage || "系统正在按计划检索、阅读与核验来源"}</span>
                      <span className="shrink-0 tabular-nums">{progress.searchCalls} 次搜索</span>
                    </div>
                    <div className="mt-2 flex items-center gap-3">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-border-light)]" role="progressbar" aria-label="研究总体进度" aria-valuenow={overallProgress} aria-valuemin={0} aria-valuemax={100}>
                        <div className="h-full rounded-full bg-[var(--color-text-primary)] transition-[width] duration-500" style={{ width: `${Math.max(3, overallProgress)}%` }} />
                      </div>
                      <Button type="button" variant="ghost" size="icon-sm" aria-label="取消运行" onClick={() => setCancelDialogOpen(true)} disabled={cancelRun.isPending}>
                        <span className="block size-2.5 rounded-[3px] bg-current" aria-hidden="true" />
                      </Button>
                    </div>

                    <details className="mt-6">
                      <summary className="cursor-pointer select-none text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]">查看详细计数与追加研究方向</summary>
                      <p className="mt-3 text-xs text-[var(--color-text-tertiary)]">仅公开状态与计数，不含隐藏推理</p>
                      <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
                        <ProgressStat label="Research Questions" value={`${progress.questionsResolved}/${progress.questionTotal} 已解决`} />
                        <ProgressStat label="待处理任务" value={String(progress.activeTasks)} />
                        <ProgressStat label="Evidence" value={String(progress.evidenceCount)} />
                        <ProgressStat label="Claim" value={String(progress.claimCount)} />
                        <ProgressStat label="引用图扩展" value={progress.citationExpansionEdges > 0 ? `${progress.citationExpansionEdges} 条边 · ${progress.citationExpansionSources} 个来源` : "本次未发生"} />
                        <ProgressStat label="图表视觉证据" value={progress.visualObservations > 0 ? `${progress.visualObservations} 条观察` : "本次未使用"} />
                        <ProgressStat label="检索 / 读取 / 模型" value={`${progress.searchCalls} / ${progress.fetchCalls} / ${progress.modelCalls}`} />
                      </div>
                      {directivePanel}
                    </details>
                  </div>

                  {activityOpen ? (
                    <ResearchActivityPanel title={plan?.objective ?? run.question} stageLabel={stageLabel ?? run.status} liveMessage={liveMessage} events={visiblePublicEvents} sources={sources} onClose={() => setActivityOpen(false)} />
                  ) : null}
                </>
              ) : null}

              {isTerminal && hasReport ? (
                <>
                  <p className="mt-5 px-1 text-xs text-[var(--color-text-tertiary)]">
                    研究完成情况：{[elapsed, `${citationCount} 次引用`, `${progress.searchCalls} 次搜索`].filter(Boolean).join(" · ")}
                  </p>
                  <section aria-label="研究报告" className="mt-3 min-w-0 max-w-full rounded-[var(--radius-lg)] bg-[var(--color-panel-muted)] px-5 py-5 sm:px-7 sm:py-6">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-accent-muted)] text-[var(--color-accent)]" aria-hidden="true">
                        <Page width={18} height={18} />
                      </span>
                      <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-[var(--color-text-primary)]">{reportTitle}</h2>
                      <span className="hidden shrink-0 text-xs text-[var(--color-text-tertiary)] sm:inline">{run._count.sourceSnapshots} 来源 · {run._count.evidence} 条证据</span>
                      <Button type="button" variant="ghost" size="icon-sm" aria-label="复制报告 Markdown" onClick={exportReport}>
                        {exported ? <Check width={16} height={16} /> : <Copy width={16} height={16} />}
                      </Button>
                      <Button type="button" variant="ghost" size="icon-sm" aria-label="展开阅读" onClick={() => setReaderOpen(true)}>
                        <Expand width={16} height={16} />
                      </Button>
                    </div>
                    <p className="mt-2 text-xs text-[var(--color-text-tertiary)]">不可修改快照 · {new Date(run.reportSnapshot!.generatedAt).toLocaleString("zh-CN")}</p>

                    <div className="relative mt-4">
                      <div className="max-h-[24rem] min-w-0 max-w-full overflow-hidden">
                        <MarkdownContent content={reportBody} className="min-w-0 max-w-full [overflow-wrap:anywhere]" />
                      </div>
                      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[var(--color-panel-muted)] via-[var(--color-panel-muted)] to-transparent opacity-95" />
                      <div className="absolute inset-x-0 bottom-3 flex justify-center">
                        <Button type="button" variant="secondary" size="sm" onClick={() => setReaderOpen(true)}>
                          <Expand width={14} height={14} />展开阅读全文
                        </Button>
                      </div>
                    </div>
                  </section>

                  {readerOpen ? (
                    <ResearchReportReader
                      reportSnapshot={run.reportSnapshot as never}
                      evidence={run.evidence as never}
                      claims={run.claims as never}
                      onClose={() => setReaderOpen(false)}
                      onExport={exportReport}
                      exported={exported}
                    />
                  ) : null}

                  {followUpPanel}

                  <div className="mt-5"><ResearchSourcesPanel sources={sources} selectedSourceId={selectedSourceId} onSelectSource={setSelectedSourceId} /></div>
                </>
              ) : null}

              {isTerminal && !hasReport ? (
                <>
                  <div className="mt-5"><ResearchSourcesPanel sources={sources} selectedSourceId={selectedSourceId} onSelectSource={setSelectedSourceId} /></div>
                  {followUpPanel}
                </>
              ) : null}

              {isTerminal ? (
                <details className="mt-5" data-testid="advanced-operations">
                  <summary className="cursor-pointer select-none rounded-[var(--radius-md)] bg-[var(--color-panel)] px-5 py-4 text-sm font-semibold text-[var(--color-text-primary)]">
                    高级操作
                    <span className="ml-2 text-xs font-normal text-[var(--color-text-tertiary)]">Evidence / Claims / 追加方向 / 预算 / 转移到论文 / 执行事件</span>
                  </summary>
                  {plan ? (
                    <div className="mt-5">
                      <ResearchPlanReviewCard plan={plan} questions={run.questions} />
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

                  {directivePanel}

                  <ResearchEvidencePanel runId={run.id} workspaceId={workspaceId} evidence={run.evidence as never} />
                  <ResearchClaimsPanel runId={run.id} workspaceId={workspaceId} claims={run.claims} evidence={run.evidence as never} />

                  {publicEventsPanel}

                  <ResearchPaperTransferPanel runId={run.id} workspaceId={workspaceId} />
                </details>
              ) : null}
            </>}
          </section>

          <section aria-label="开始新的研究" className="mx-auto mt-10 max-w-3xl pb-10">
            <p className="mb-2 px-2 text-[11px] font-medium text-[var(--color-text-tertiary)]">开始新的研究</p>
            <ResearchComposer onSend={sendFromComposer} disabled={createRunMutation.isPending} contextHint={workspace.project?.name ? `新研究将读取项目「${workspace.project.name}」的资料作为证据` : undefined} />
            {composerUploads.length > 0 ? (
              <ul aria-label="附件上传状态" className="mt-2 space-y-1 px-2">
                {composerUploads.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-3 text-xs">
                    <span className="min-w-0 truncate text-[var(--color-text-secondary)]">{item.name}</span>
                    <span className={item.status === "failed" ? "shrink-0 text-[var(--color-danger)]" : "shrink-0 text-[var(--color-text-tertiary)]"}>
                      {item.status === "uploading" ? "上传中…" : item.status === "done" ? "完成" : "失败"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            {composerNotice ? <p role="status" className="mt-2 px-2 text-xs text-[var(--color-text-tertiary)]">{composerNotice}</p> : null}
            {composerError ? <p role="alert" className="mt-2 px-2 text-xs text-[var(--color-danger)]">{composerError}（修改后重新发送即可重试，草稿已保留）</p> : null}
          </section>
        </div>
      </div>
    </main>
  );
}
