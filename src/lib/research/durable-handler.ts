import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import type { AgentCheckpoint } from "@/lib/agent/executions/agent-execution-store";
import type { AgentModel, AgentUsage } from "@/lib/agent/contracts";
import type { AgentExecutionHandler, AgentExecutionHandlerContext, AgentExecutionHandlerResult } from "@/lib/agent/executions/agent-execution-runner";
import type { ChatModel } from "@/lib/chat/model-catalog";
import { evaluateResearchStop, finalizationBudgetRemaining, getResearchBudget, getResearchExplorationBudget, getResearchFinalizationReserve, hasResearchModelCallBudget, RESEARCH_DEFAULT_CALL_ESTIMATE_TOKENS, releaseResearchBudgetCounter, tryReserveResearchBudgetCounter } from "./budget";
import { ingestResearchReadSource, markCandidateFetched, markCandidateRejected } from "./evidence-ingestion";
import { buildClaimExtractionPrompt, buildQuestionEvidenceFingerprint, normalizeClaimExtractorOutput, type ClaimExtractorDecision } from "./claim-extraction";
import { computeDeterministicClaimVerification, mergeClaimVerification, persistExtractedClaimsForQuestion, snapshotScopeTypeOf } from "./claim-graph";
import { prioritizeResearchCandidates } from "./candidate-priority";
import {
  decideCitationExpansion,
  emptyCitationGraphMetrics,
  expandCitationGraphForQuestion,
  resolveCitationGraphPolicy,
  resolveSeedSciverseUniqueId,
  selectGraphSeeds,
  type GraphSeedInput,
} from "./citation-graph";
import { createResearchToolInvoker, createToolBackedResearchSourceProvider, parseResearchResourceRefs, type ResearchCandidate, type ResearchProviderContext, type ResearchSourceProvider, type ResearchToolInvoker, type ResearchResourceRef } from "./source-provider";
import { academicCitationSignal, clampQuality, computeEvidenceRecency, computeResearchInformationGain, computeSourceDiversity, estimateSourceQuality, summarizeResearchQuality } from "./quality";
import { assertResearchRunTransition, isTerminalResearchRunStatus } from "./state-machine";
import type { ResearchBudgetLimits, ResearchPlanSnapshot, ResearchQuestionStatus, ResearchRunStatus } from "./contracts";
import { nextResearchTaskRetryStatus } from "./task-retry";
import { addResearchUsage, EMPTY_RESEARCH_USAGE } from "./accounting";
import { resolveCommanderModel } from "./model-routing";
import { applyResearchPlannerDecision } from "./plan";
import { selectVerificationRepairTargets, verificationRepairInstruction } from "./verification-repair";
import { buildResearchReportStructure } from "./report-document";
import { buildResearchCitationMap } from "./report-citations";
import { deterministicSourceAssessment, mergeSourceAssessments, normalizeSourceTriageDecision } from "./source-triage";
import {
  buildEvaluatorPrompt,
  buildPlannerPrompt,
  buildQueryStrategyPrompt,
  buildReportArchitectPrompt,
  buildReportAuditorPrompt,
  buildReportWriterPrompt,
  buildSourceTriagePrompt,
  buildVerifierPrompt,
  RESEARCH_PROMPT_VERSIONS,
  SOURCE_TRIAGE_CANDIDATE_CHAR_BUDGET,
  type ReportClaimPacket,
} from "./prompts";
import { deterministicReportAudit, evidenceMarkersInReport, fallbackReportArchitecture, normalizeReportArchitecture, normalizeReportAuditDecision } from "./report-quality";
import { deterministicEvaluatorDecision } from "./evaluator";
import { methodologyForStage, publicResearchSkillSnapshot } from "./research-skills";
import {
  buildVisualEvidenceFingerprint,
  buildVisualEvidencePrompt,
  decideVisualEvidenceNeed,
  emptyVisualEvidenceMetrics,
  getResearchVisualPolicy,
  normalizeVisualObservationOutput,
  persistVisualObservations,
  VISUAL_EVIDENCE_MAX_IMAGE_BYTES,
  type VisualAnalysisResourceInput,
  type VisualResourceForPersistence,
} from "./visual-evidence";
import {
  normalizeResearchEvaluatorDecision,
  normalizeResearchPlannerDecision,
  normalizeResearchVerifierDecision,
  normalizeResearchWorkerDecision,
  runResearchModelStage,
  type ResearchEvaluatorDecision,
  type ResearchPlannerDecision,
  type ResearchVerifierDecision,
  type ResearchWorkerDecision,
} from "./model-stage";

type ResearchState = NonNullable<AgentCheckpoint["researchState"]>;

/** 图表扫描读取窗口（Unicode 码点）；只在预算内读一到两个窗口。 */
const VISUAL_SCAN_WINDOW = 6_000;
/** 传给视觉模型的正文上下文上限（有界）。 */
const VISUAL_BODY_CONTEXT_CHARS = 4_000;
/** checkpoint 中保留的 provider 降级代码上限。 */
const MAX_RESEARCH_DEGRADATIONS = 12;
/**
 * 阶段 prompt 内 Evidence 摘录的确定性上限（全文仍在 Evidence 行，经 evidenceId
 * + locator 可追溯）。历史重发消除后，终审阶段 prompt 的主要构成是 evidence
 * 摘录原文（每条可达 2000 字符 × 数十条），按阶段用途分级截断：
 * evaluator 判断覆盖度看 statement 即可；claim extractor 需要更多原文 grounding；
 * verifier 核对支持关系；report packet 只为写作提供引用上下文。
 */
const EVIDENCE_EXCERPT_CAPS = { evaluator: 800, claimExtractor: 1_200, verifier: 1_000, reportPacket: 800 } as const;

function capEvidenceExcerpt(text: string | null | undefined, cap: number): string {
  if (typeof text !== "string") return "";
  return text.length <= cap ? text : `${text.slice(0, cap)}…[截断，全文见 Evidence 记录]`;
}

/**
 * 预估感知闸门的角色估计：无实测时按预算档位推导保守默认——固定 24k 会让
 * quick（探索预算 28k）在第一调用就被闸门挡死，因此默认估计不超过预算的 1/10。
 */
function researchCallEstimate(state: ResearchState, role: string, limits: ResearchBudgetLimits): number {
  const measured = state.modelCallEstimates?.[role];
  if (measured && measured > 0) return measured;
  return Math.min(RESEARCH_DEFAULT_CALL_ESTIMATE_TOKENS, Math.max(2_000, Math.floor(limits.maxTokens / 10)));
}

function json(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}

function checkpointWithResearch(checkpoint: AgentCheckpoint, researchState: ResearchState): AgentCheckpoint {
  return { ...checkpoint, researchState };
}

function recordResearchModelStage(state: ResearchState, result: { attempted: boolean; usage: AgentUsage | null; model: AgentModel }, options?: { modelCallReserved?: boolean; estimateRole?: string }) {
  if (result.attempted && !options?.modelCallReserved) state.modelCalls += 1;
  if (!result.usage) return;
  const usage = addResearchUsage({ promptTokens: state.promptTokens ?? 0, completionTokens: state.completionTokens ?? 0, totalTokens: state.totalTokens ?? 0, costCredits: state.costCredits ?? 0 }, result.usage, result.model);
  state.promptTokens = usage.promptTokens;
  state.completionTokens = usage.completionTokens;
  state.totalTokens = usage.totalTokens;
  state.costCredits = usage.costCredits;
  // 预估感知闸门素材：按角色记录单次调用实测（取 max，防一次异常大调用被
  // 后续较小的同阶段调用低估）。只影响 go/no-go 决策，不改预算口径。
  if (options?.estimateRole) {
    const total = result.usage.totalTokens || result.usage.promptTokens + result.usage.completionTokens;
    if (total > 0) {
      state.modelCallEstimates = { ...state.modelCallEstimates, [options.estimateRole]: Math.max(state.modelCallEstimates?.[options.estimateRole] ?? 0, total) };
    }
  }
}

async function appendPublicEvent(context: AgentExecutionHandlerContext, input: {
  key: string;
  kind: string;
  runId: string;
  message: string;
  publicData?: Record<string, unknown>;
}) {
  await context.appendEvent({
    key: input.key,
    type: "research_event",
    payload: json({ kind: input.kind, runId: input.runId, message: input.message, publicData: input.publicData ?? {}, createdAt: new Date().toISOString() }),
  });
}

async function transitionRun(runId: string, next: ResearchRunStatus) {
  const current = await prisma.researchRun.findUnique({ where: { id: runId }, select: { status: true } });
  if (!current) throw new Error("Research Run 不存在");
  if (current.status === next) return;
  assertResearchRunTransition(current.status as ResearchRunStatus, next);
  await prisma.researchRun.update({ where: { id: runId }, data: { status: next } });
}

/**
 * 把 durable execution 的终态失败投影回 ResearchRun。execution 在 worker 内失败
 * （重试耗尽、handler 返回不可重试错误、租约毒化）时，API 层的 dispatch try/catch
 * 早已返回；没有这道投影 run 会永远停在 queued/researching，用户看到「0 进度」。
 */
export async function projectResearchRunExecutionFailure(input: {
  runId: string;
  code: string;
  message: string;
  now: Date;
}): Promise<void> {
  const run = await prisma.researchRun.findUnique({ where: { id: input.runId }, select: { status: true, metrics: true } });
  if (!run) return;
  if (isTerminalResearchRunStatus(run.status as ResearchRunStatus)) return;
  const metrics = run.metrics && typeof run.metrics === "object" && !Array.isArray(run.metrics)
    ? run.metrics as Record<string, unknown>
    : {};
  await prisma.researchRun.update({
    where: { id: input.runId },
    data: {
      status: "failed",
      completedAt: input.now,
      metrics: {
        ...metrics,
        executionFailure: { code: input.code, message: input.message, at: input.now.toISOString() },
      },
    },
  });
}

async function persistCandidate(input: {
  workspaceId: string;
  runId: string;
  questionId: string;
  candidate: ResearchCandidate;
}) {
  const existing = await prisma.researchSourceCandidate.findFirst({
    where: { runId: input.runId, provider: input.candidate.provider, externalId: input.candidate.externalId },
  });
  if (existing) return existing;
  return prisma.researchSourceCandidate.create({
    data: {
      workspaceId: input.workspaceId,
      runId: input.runId,
      questionId: input.questionId,
      provider: input.candidate.provider,
      externalId: input.candidate.externalId,
      title: input.candidate.title,
      url: input.candidate.url,
      metadata: json(input.candidate.metadata),
      status: "selected",
    },
  });
}

async function architectReportWithExistingRuntime(input: {
  userId: string;
  conversationId: string;
  projectId: string | null;
  signal: AbortSignal;
  plan: ResearchPlanSnapshot;
  questions: unknown[];
  claims: ReportClaimPacket[];
  coverageGaps: string[];
  modelOverride?: ChatModel | null;
  methodology?: string;
}) {
  return runResearchModelStage({
    role: "research.report_architect",
    userId: input.userId,
    conversationId: input.conversationId,
    projectId: input.projectId,
    signal: input.signal,
    modelOverride: input.modelOverride,
    prompt: buildReportArchitectPrompt({ plan: input.plan, questions: input.questions, claims: input.claims, coverageGaps: input.coverageGaps, methodology: input.methodology }),
    parse: (content) => normalizeReportArchitecture(JSON.parse(content.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "")), new Set(input.claims.map((claim) => claim.id))),
  });
}

async function writeFinalReportWithExistingRuntime(input: {
  userId: string;
  conversationId: string;
  projectId: string | null;
  signal: AbortSignal;
  plan: ResearchPlanSnapshot;
  architecture: unknown;
  claims: ReportClaimPacket[];
  profile: string;
  modelOverride?: ChatModel | null;
  repair?: { draft: string; instructions: string[] };
  methodology?: string;
}) {
  const prompt = buildReportWriterPrompt({ plan: input.plan, architecture: input.architecture, claims: input.claims, profile: input.profile, methodology: input.methodology });
  return runResearchModelStage<string>({
    role: "research.synthesizer",
    userId: input.userId,
    conversationId: input.conversationId,
    projectId: input.projectId,
    signal: input.signal,
    modelOverride: input.modelOverride,
    prompt: input.repair ? `${prompt}\n\n受控修订要求：${JSON.stringify(input.repair.instructions)}\n当前草稿：\n${input.repair.draft}` : prompt,
    parse: (content) => content.trim() || null,
  });
}

async function auditFinalReportWithExistingRuntime(input: {
  userId: string;
  conversationId: string;
  projectId: string | null;
  signal: AbortSignal;
  plan: ResearchPlanSnapshot;
  architecture: unknown;
  claims: ReportClaimPacket[];
  report: string;
  bibliographySourceIds: string[];
  modelOverride?: ChatModel | null;
  methodology?: string;
}) {
  return runResearchModelStage({
    role: "research.report_auditor",
    userId: input.userId,
    conversationId: input.conversationId,
    projectId: input.projectId,
    signal: input.signal,
    modelOverride: input.modelOverride,
    prompt: buildReportAuditorPrompt({ plan: input.plan, report: input.report, architecture: input.architecture, claims: input.claims, bibliographySourceIds: input.bibliographySourceIds, methodology: input.methodology }),
    parse: (content) => normalizeReportAuditDecision(JSON.parse(content.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, ""))),
  });
}

export function createDurableResearchExecutionHandler(options: { provider?: ResearchSourceProvider; toolInvoker?: ResearchToolInvoker } = {}): AgentExecutionHandler {
  const provider = options.provider ?? createToolBackedResearchSourceProvider();
  const toolInvoker = options.toolInvoker ?? createResearchToolInvoker();
  return async (context): Promise<AgentExecutionHandlerResult> => {
    const checkpoint = context.execution.checkpoint;
    const request = checkpoint?.request;
    if (!checkpoint || request?.executionKind !== "research" || !request.researchRunId) {
      return { kind: "failed", code: "invalid_research_checkpoint", message: "Research checkpoint is missing its run identity", retryable: false };
    }
    // 不按 execution.userId 二次过滤：execution 由服务端在确认计划时为该 run 创建，
    // 归属在创建时已校验；运行期执行行与 run 可能独立迁移归属（历史数据不一致会
    // 让这里永久 research_run_not_found，把 run 卡死在 queued）。
    const run = await prisma.researchRun.findFirst({ where: { id: request.researchRunId }, include: { workspace: true, activePlanVersion: true } });
    if (!run) return { kind: "failed", code: "research_run_not_found", message: "Research Run 不存在", retryable: false };
    if (run.status === "cancelled") return { kind: "cancelled", message: "Research Run 已取消", checkpoint };
    if (run.status === "awaiting_confirmation") {
      await context.saveCheckpoint(checkpoint);
      return { kind: "rescheduled", checkpoint, scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1_000) };
    }
    if (run.status === "awaiting_scope_confirmation") {
      await appendPublicEvent(context, {
        key: `research:scope:waiting:${run.id}:${context.execution.attempt}`,
        kind: "scope_confirmation_required",
        runId: run.id,
        message: "研究范围或预算扩大，等待用户确认后继续",
        publicData: { status: run.status },
      });
      await context.saveCheckpoint(checkpoint);
      return {
        kind: "rescheduled",
        checkpoint,
        // The existing durable execution remains queued and is explicitly
        // resumed by the scope-confirmation API; this avoids a hot loop.
        scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
      };
    }

    /** 最近一次评估得出的预算停止原因（持久化到 state，进入 run.metrics.budgetStopReason）。 */
    let lastBudgetStopReason = checkpoint.researchState?.budgetStopReason ?? "continue";
    const existing = checkpoint.researchState;
    const state: ResearchState = existing ?? {
      stage: "researching",
      modelCalls: 0,
      ...EMPTY_RESEARCH_USAGE,
      searchCalls: 0,
      fetchCalls: 0,
      sourceCount: 0,
      replanCount: 0,
      verificationRepairs: 0,
    };
    const limits = getResearchBudget(run.workspace.budgetProfile);
    const explorationLimits = getResearchExplorationBudget(run.workspace.budgetProfile);
    const finalizationReserve = getResearchFinalizationReserve(run.workspace.budgetProfile);
    const modelOverride = resolveCommanderModel(run.commanderModel);
    // 收尾预算保留：visual_evidence 阶段读图与图表扫描都要占用 fetchCalls，但阅读
    // 阶段很容易把整个 fetch 预算吃满（生产 deep run 实测 40/40），使视觉阶段永远
    // 无法执行。因此只要视觉阶段还没跑完，就在发现/扩展阶段扣掉它需要的额度，等
    // 视觉阶段真正执行时再用完整额度。
    const visualPolicyForReserve = getResearchVisualPolicy(run.workspace.budgetProfile);
    const visualFetchReserve = limits.fetchCalls > 0 && !state.visualEvidence?.done
      ? Math.min(
          limits.fetchCalls,
          visualPolicyForReserve.maxFigureScanReads + visualPolicyForReserve.maxResourceFetches,
        )
      : 0;
    const researchLimits = visualFetchReserve > 0
      ? { ...explorationLimits, fetchCalls: Math.max(0, explorationLimits.fetchCalls - visualFetchReserve) }
      : explorationLimits;
    const domainProfile = (run.activePlanVersion?.plan as unknown as ResearchPlanSnapshot | undefined)?.domainProfile;
    const planSnapshot = run.activePlanVersion?.plan as unknown as ResearchPlanSnapshot | undefined;
    const methodology = (stage: Parameters<typeof methodologyForStage>[1]) =>
      methodologyForStage(run.modelConfiguration, stage);
    // 有界收集 Sciverse advanced filter 的生效情况（诊断与 run.metrics 用）。
    const scholarlyFilterAccumulator = {
      applied: new Set<string>(state.scholarlyFilters?.applied ?? []),
      dropped: new Set<string>(state.scholarlyFilters?.dropped ?? []),
      questions: state.scholarlyFilters?.questions ?? 0,
      relaxedRetry: state.scholarlyFilters?.relaxedRetry ?? false,
    };
    // 有界、去重的 provider 降级代码（用户可读文案见 state-machine.ts）。
    const degradationCodes = new Set<string>((state.degradations ?? []).slice(0, MAX_RESEARCH_DEGRADATIONS));
    const providerContext: ResearchProviderContext = {
      userId: context.execution.userId,
      conversationId: context.execution.conversationId,
      executionId: context.execution.id,
      runId: run.id,
      projectId: run.workspace.projectId,
      signal: context.signal,
      domainProfileKey: run.workspace.domainProfileKey,
      budgetProfile: run.workspace.budgetProfile,
      planTimeRange: typeof planSnapshot?.timeRange === "string" ? planSnapshot.timeRange : null,
      recordScholarlyFilter: (record) => {
        scholarlyFilterAccumulator.questions += 1;
        for (const key of record.applied) scholarlyFilterAccumulator.applied.add(key);
        for (const entry of record.dropped) scholarlyFilterAccumulator.dropped.add(entry);
        if (record.relaxedRetry) scholarlyFilterAccumulator.relaxedRetry = true;
      },
      recordDegradation: (code) => {
        if (degradationCodes.size < MAX_RESEARCH_DEGRADATIONS) degradationCodes.add(code);
      },
    };

    if (state.stage === "planning") {
      const activePlanVersion = run.activePlanVersion;
      const currentPlan = activePlanVersion?.plan as unknown as ResearchPlanSnapshot | undefined;
      if (!activePlanVersion || !currentPlan) return { kind: "failed", code: "research_plan_missing", message: "Research Plan 不存在", retryable: false };
      const plannerResult = await runResearchModelStage<ResearchPlannerDecision>({
        role: "research.planner",
        userId: context.execution.userId,
        conversationId: context.execution.conversationId,
        projectId: run.workspace.projectId,
        signal: context.signal,
        modelOverride,
        prompt: buildPlannerPrompt({ plan: currentPlan, profile: run.workspace.budgetProfile, domainProfile, methodology: methodology("planner") }),
      });
      recordResearchModelStage(state, plannerResult, { estimateRole: "research.planner" });
      const revisedPlan = applyResearchPlannerDecision(currentPlan, normalizeResearchPlannerDecision(plannerResult.value));
      const changed = JSON.stringify(revisedPlan) !== JSON.stringify(currentPlan);
      let planVersionId = activePlanVersion.id;
      if (changed) {
        const result = await prisma.$transaction(async (tx) => {
          const maxVersion = await tx.researchPlanVersion.aggregate({ where: { workspaceId: run.workspaceId }, _max: { version: true } });
          const nextVersion = await tx.researchPlanVersion.create({
            data: {
              workspaceId: run.workspaceId,
              runId: run.id,
              version: (maxVersion._max.version ?? 0) + 1,
              plan: json(revisedPlan),
              reason: "Planner 初始结构化规划",
            },
          });
          for (const [index, question] of revisedPlan.researchQuestions.entries()) {
            await tx.researchQuestion.upsert({
              where: { runId_key: { runId: run.id, key: question.key } },
              create: { runId: run.id, key: question.key, title: question.title, question: question.question, priority: question.priority, orderIndex: index, completionCriteria: question.completionCriteria, sourceStrategy: question.sourceStrategy },
              update: { title: question.title, question: question.question, priority: question.priority, orderIndex: index, completionCriteria: question.completionCriteria, sourceStrategy: question.sourceStrategy },
            });
          }
          await tx.researchRun.update({ where: { id: run.id }, data: { question: revisedPlan.researchGoal, planVersionId: nextVersion.id } });
          return nextVersion;
        });
        planVersionId = result.id;
      }
      state.stage = "researching";
      await transitionRun(run.id, "awaiting_confirmation");
      await context.saveCheckpoint(checkpointWithResearch(checkpoint, state));
      await appendPublicEvent(context, { key: `research:plan:created:${run.id}:${planVersionId}`, kind: "plan_created", runId: run.id, message: "Planner 已生成结构化研究计划，等待确认", publicData: { planVersionId, questionCount: revisedPlan.researchQuestions.length, modelAttempted: plannerResult.attempted } });
      return { kind: "rescheduled", checkpoint: checkpointWithResearch(checkpoint, state), scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1_000) };
    }

    if (state.stage === "researching") {
      await transitionRun(run.id, "researching");
      const elapsedMs = Date.now() - (run.startedAt ?? run.createdAt).getTime();
      // 预估感知：连一次 worker 调用的「实测 × 安全系数」都覆盖不了时，同样视为
      // 硬预算触顶直接收尾——否则任务在闸门处回 retrying、入口检查又放行，
      // 会形成 250ms 的热循环。
      const explorationCallBlocked = !hasResearchModelCallBudget({ limits: researchLimits, totalTokens: state.totalTokens, costCredits: state.costCredits, estimateTokens: researchCallEstimate(state, "research.worker", researchLimits) });
      const hardBudgetReached = explorationCallBlocked || elapsedMs >= researchLimits.wallTimeMs || state.modelCalls >= researchLimits.modelCalls || (state.totalTokens ?? 0) >= researchLimits.maxTokens || (state.costCredits ?? 0) >= researchLimits.maxCostCredits || state.searchCalls >= researchLimits.searchCalls || state.fetchCalls >= researchLimits.fetchCalls || state.sourceCount >= researchLimits.maxSources;
      if (hardBudgetReached) {
        state.stage = "evaluating";
        lastBudgetStopReason = "hard_budget";
        state.budgetStopReason = lastBudgetStopReason;
        await appendPublicEvent(context, { key: `research:budget:reached:${run.id}:${state.searchCalls}:${state.fetchCalls}`, kind: "budget_updated", runId: run.id, message: "已达到研究硬预算，进入评估阶段", publicData: { elapsedMs, modelCalls: state.modelCalls, promptTokens: state.promptTokens ?? 0, completionTokens: state.completionTokens ?? 0, totalTokens: state.totalTokens ?? 0, costCredits: state.costCredits ?? 0, searchCalls: state.searchCalls, fetchCalls: state.fetchCalls, sourceCount: state.sourceCount, limits } });
        await transitionRun(run.id, "evaluating");
        await context.saveCheckpoint(checkpointWithResearch(checkpoint, state));
        return { kind: "rescheduled", checkpoint: checkpointWithResearch(checkpoint, state) };
      }
      await prisma.researchTask.updateMany({
        where: { runId: run.id, status: "running" },
        data: { status: "retrying", lastError: json({ code: "worker_recovered_running_task" }) },
      });
      const tasks = await prisma.researchTask.findMany({ where: { runId: run.id, status: { in: ["pending", "retrying"] } }, include: { question: true }, orderBy: [{ priority: "asc" }, { createdAt: "asc" }], take: Math.min(researchLimits.researcherConcurrency, Math.max(0, researchLimits.modelCalls - state.modelCalls)) });
      const directives = await prisma.researchUserDirective.findMany({ where: { runId: run.id, status: "applied" }, orderBy: { createdAt: "asc" }, select: { text: true } });
      const directiveContext = directives.length > 0 ? `\n用户追加研究方向（在当前预算内吸收）：${directives.map((directive) => directive.text).join("；")}` : "";
      await appendPublicEvent(context, { key: "research:stage:researching", kind: "stage_changed", runId: run.id, message: "已进入研究阶段", publicData: { taskCount: tasks.length, concurrency: limits.researcherConcurrency } });
      await Promise.all(tasks.map(async (task) => {
        if (context.signal.aborted || !task.question) return;
        const attempt = task.attempt + 1;
        if (task.question.researchAttempts >= limits.maxQuestionResearchAttempts) {
          await prisma.researchTask.update({ where: { id: task.id }, data: { status: "failed", lastError: json({ code: "question_research_budget_exhausted", maximum: limits.maxQuestionResearchAttempts }), completedAt: new Date() } });
          await appendPublicEvent(context, { key: `research:task:budget:${task.id}`, kind: "task_completed", runId: run.id, message: `${task.question.title} 已达到单题研究次数上限`, publicData: { questionId: task.question.id, maximum: limits.maxQuestionResearchAttempts } });
          return;
        }
        await prisma.researchTask.update({ where: { id: task.id }, data: { status: "running", attempt, startedAt: new Date() } });
        await prisma.researchQuestion.update({ where: { id: task.question.id }, data: { status: "researching", researchAttempts: { increment: 1 } } });
        await appendPublicEvent(context, { key: `research:task:start:${task.id}`, kind: "task_started", runId: run.id, message: `开始研究：${task.question.title}`, publicData: { questionId: task.question.id, priority: task.question.priority } });
        try {
          // 单次调用的 token 消耗在返回前未知：除同步预留调用计数外，发起前
          // 用「上次同阶段实测 × 安全系数」做预估感知闸门——纯余量检查挡不住
          // 单次 call 跳变式超支。余量不足时不点火新调用，任务回到 retrying，
          // 下一轮 handler 的 hardBudgetReached 会把 Run 送入 evaluating 优雅收尾。
          const workerHeadroom = hasResearchModelCallBudget({ limits: researchLimits, totalTokens: state.totalTokens, costCredits: state.costCredits, estimateTokens: researchCallEstimate(state, "research.worker", researchLimits) });
          if (!workerHeadroom || !tryReserveResearchBudgetCounter(state, researchLimits, "modelCalls")) {
            await prisma.researchTask.update({ where: { id: task.id }, data: { status: "retrying", lastError: json({ code: workerHeadroom ? "research_model_budget_reserved" : "research_token_budget_exhausted" }) } });
            return;
          }
          const workerResult = await runResearchModelStage<ResearchWorkerDecision>({
            role: "research.worker",
            userId: context.execution.userId,
            conversationId: context.execution.conversationId,
            projectId: run.workspace.projectId,
            signal: context.signal,
            modelOverride,
            prompt: buildQueryStrategyPrompt({
              plan: planSnapshot!,
              questionKey: task.question.key,
              question: task.question.question,
              task: task.instructions ?? "沿用 Research Question，优先补充独立来源。",
              domainProfile,
              directiveContext,
              methodology: methodology("retrieval"),
            }),
          });
          recordResearchModelStage(state, workerResult, { modelCallReserved: true, estimateRole: "research.worker" });
          const workerDecision = normalizeResearchWorkerDecision(workerResult.value, task.question.question, task.question.key);
          await appendPublicEvent(context, { key: `research:query:${task.id}:${attempt}`, kind: "task_started", runId: run.id, message: `已生成检索策略：${task.question.title}`, publicData: { questionId: task.question.id, queries: workerDecision.queries.map((item) => item.query) } });
          for (const strategy of workerDecision.queries) {
            const query = strategy.query;
            if (context.signal.aborted || !tryReserveResearchBudgetCounter(state, researchLimits, "searchCalls")) break;
            const taskContext: ResearchProviderContext = { ...providerContext, question: task.question.question };
            const candidates = await provider.search(taskContext, query);
            const prioritized = prioritizeResearchCandidates(candidates, domainProfile?.preferredProviders).slice(0, 12);
            const deterministicAssessments = new Map(prioritized.map((candidate, index) => [String(index), deterministicSourceAssessment({ question: task.question!.question, strategy, candidate })]));
            let modelAssessments: ReturnType<typeof normalizeSourceTriageDecision> = {};
            // triage 是 researching 循环里最贵的调用（12 候选 × 摘录）。预估感知
            // 闸门 + 候选字符预算双重收敛：预算越紧，每条摘录越短（有下限）。
            const triageHeadroom = hasResearchModelCallBudget({ limits: researchLimits, totalTokens: state.totalTokens, costCredits: state.costCredits, estimateTokens: researchCallEstimate(state, "research.source_triage", researchLimits) });
            const triageCandidateCharBudget = Math.min(
              SOURCE_TRIAGE_CANDIDATE_CHAR_BUDGET,
              Math.max(2_400, (researchLimits.maxTokens - (state.totalTokens ?? 0)) * 2),
            );
            if (triageHeadroom && prioritized.some((_, index) => deterministicAssessments.get(String(index))?.relevance !== "irrelevant") && tryReserveResearchBudgetCounter(state, researchLimits, "modelCalls")) {
              const triageResult = await runResearchModelStage<{ candidates?: unknown }>({
                role: "research.source_triage",
                userId: context.execution.userId,
                conversationId: context.execution.conversationId,
                projectId: run.workspace.projectId,
                signal: context.signal,
                modelOverride,
                prompt: buildSourceTriagePrompt({ plan: planSnapshot!, question: task.question.question, strategy, candidates: prioritized.map((candidate, index) => ({ id: String(index), candidate })), methodology: methodology("source_triage"), candidateCharBudget: triageCandidateCharBudget }),
              });
              recordResearchModelStage(state, triageResult, { modelCallReserved: true, estimateRole: "research.source_triage" });
              modelAssessments = normalizeSourceTriageDecision(triageResult.value, new Set(prioritized.map((_, index) => String(index))));
            }
            let adjacentAccepted = 0;
            for (const [candidateIndex, candidate] of prioritized.entries()) {
              if (context.signal.aborted || state.sourceCount >= limits.maxSources) break;
              const assessment = mergeSourceAssessments(deterministicAssessments.get(String(candidateIndex))!, modelAssessments[String(candidateIndex)]);
              const assessedCandidate = { ...candidate, metadata: { ...candidate.metadata, sourceAssessment: assessment, queryPurpose: strategy.purpose, intendedSourceRole: strategy.sourceRole } };
              const savedCandidate = await persistCandidate({ workspaceId: run.workspaceId, runId: run.id, questionId: task.question.id, candidate: assessedCandidate });
              if (assessment.relevance === "irrelevant" || (assessment.relevance === "adjacent" && adjacentAccepted >= 2)) {
                await markCandidateRejected(savedCandidate.id);
                continue;
              }
              if (assessment.relevance === "adjacent") adjacentAccepted += 1;
              // 同一 Run 内已被成功读取的候选不重复 fetch：Evidence 由
              // (runId, evidenceKey) 幂等，再读只会烧 fetch budget 而不产生新证据。
              if (savedCandidate.status === "fetched") continue;
              await appendPublicEvent(context, { key: `research:candidate:${savedCandidate.id}`, kind: "source_candidate_discovered", runId: run.id, message: `发现来源候选：${candidate.title}`, publicData: { candidateId: savedCandidate.id, provider: candidate.provider, url: candidate.url, query } });
              if (!tryReserveResearchBudgetCounter(state, limits, "sourceCount")) break;
              if (!tryReserveResearchBudgetCounter(state, researchLimits, "fetchCalls")) {
                releaseResearchBudgetCounter(state, "sourceCount");
                continue;
              }
              let saved: Awaited<ReturnType<typeof ingestResearchReadSource>> = null;
              let readTitle = candidate.title;
              try {
                const read = await provider.read(taskContext, assessedCandidate);
                if (!read) {
                  releaseResearchBudgetCounter(state, "sourceCount");
                  await markCandidateRejected(savedCandidate.id);
                  continue;
                }
                readTitle = read.title;
                saved = await ingestResearchReadSource({ userId: context.execution.userId, workspaceId: run.workspaceId, runId: run.id, questionId: task.question.id, read });
              } catch (error) {
                releaseResearchBudgetCounter(state, "sourceCount");
                throw error;
              }
              if (!saved) continue;
              await markCandidateFetched(savedCandidate.id, saved.source.id);
              await appendPublicEvent(context, { key: `research:snapshot:${saved.snapshot.id}`, kind: "source_snapshot_created", runId: run.id, message: `已读取并保存来源：${readTitle}`, publicData: { sourceId: saved.source.id, snapshotId: saved.snapshot.id, evidenceId: saved.evidences[0]?.id ?? null, evidenceIds: saved.evidences.map((evidence) => evidence.id), rawContentPersisted: saved.rawContentPersisted, evidenceCount: state.sourceCount, query } });
            }
          }
          await prisma.researchTask.update({ where: { id: task.id }, data: { status: "completed", completedAt: new Date() } });
          await appendPublicEvent(context, { key: `research:task:complete:${task.id}`, kind: "task_completed", runId: run.id, message: `已完成研究：${task.question.title}`, publicData: { questionId: task.question.id } });
        } catch (error) {
          const status = nextResearchTaskRetryStatus(attempt, task.maxAttempts);
          await prisma.researchTask.update({ where: { id: task.id }, data: { status, lastError: json({ code: "research_task_failed", message: error instanceof Error ? error.message : String(error), attempt }), completedAt: status === "failed" ? new Date() : null } });
          await appendPublicEvent(context, { key: `research:task:failed:${task.id}:${attempt}`, kind: "task_completed", runId: run.id, message: `${task.question.title}：${status === "retrying" ? "本地重试" : "达到重试上限"}`, publicData: { questionId: task.question.id, status, attempt } });
        }
      }));
      state.degradations = [...degradationCodes].slice(0, MAX_RESEARCH_DEGRADATIONS);
      state.scholarlyFilters = {
        applied: [...scholarlyFilterAccumulator.applied],
        dropped: [...scholarlyFilterAccumulator.dropped],
        questions: scholarlyFilterAccumulator.questions,
        relaxedRetry: scholarlyFilterAccumulator.relaxedRetry,
      };
      const retryableTasks = await prisma.researchTask.count({ where: { runId: run.id, status: "retrying" } });
      if (retryableTasks > 0) {
        await context.saveCheckpoint(checkpointWithResearch(checkpoint, state));
        return { kind: "rescheduled", checkpoint: checkpointWithResearch(checkpoint, state), scheduledAt: new Date(Date.now() + 250) };
      }
      state.stage = "evaluating";
      await transitionRun(run.id, "evaluating");
      await context.saveCheckpoint(checkpointWithResearch(checkpoint, state));
      return { kind: "rescheduled", checkpoint: checkpointWithResearch(checkpoint, state) };
    }

    if (state.stage === "evaluating") {
      const questions = await prisma.researchQuestion.findMany({ where: { runId: run.id }, include: { evidence: { where: { status: "active" }, select: { id: true, statement: true, excerpt: true, evidenceType: true, provenance: true, sourceSnapshot: { select: { retrievedAt: true, metadata: true, source: { select: { id: true, kind: true, title: true, canonicalKey: true, metadata: true } } } } } } }, orderBy: { orderIndex: "asc" } });
      let unresolvedCritical: typeof questions[number] | undefined;
      const evaluatedStatuses = new Map<string, ResearchQuestionStatus>();
      for (const question of questions) {
        const evidencePackets = question.evidence.map((item) => {
          const sourceMetadata = item.sourceSnapshot.source.metadata && typeof item.sourceSnapshot.source.metadata === "object" && !Array.isArray(item.sourceSnapshot.source.metadata) ? item.sourceSnapshot.source.metadata as Record<string, unknown> : {};
          const evidenceProvenance = item.provenance && typeof item.provenance === "object" && !Array.isArray(item.provenance) ? item.provenance as Record<string, unknown> : {};
          const snapshotMetadata = item.sourceSnapshot.metadata && typeof item.sourceSnapshot.metadata === "object" && !Array.isArray(item.sourceSnapshot.metadata) ? item.sourceSnapshot.metadata as Record<string, unknown> : {};
          const assessmentValue = evidenceProvenance.sourceAssessment ?? sourceMetadata.sourceAssessment;
          const assessment = assessmentValue && typeof assessmentValue === "object" && !Array.isArray(assessmentValue) ? assessmentValue as Record<string, unknown> : {};
          const scope = snapshotMetadata.scope && typeof snapshotMetadata.scope === "object" && !Array.isArray(snapshotMetadata.scope) ? snapshotMetadata.scope as Record<string, unknown> : {};
          return { id: item.id, statement: item.statement, excerpt: capEvidenceExcerpt(item.excerpt, EVIDENCE_EXCERPT_CAPS.evaluator), sourceTitle: item.sourceSnapshot.source.title, year: sourceMetadata.year ?? null, venue: sourceMetadata.venue ?? null, sourceRole: assessment.sourceRole ?? evidenceProvenance.intendedSourceRole ?? sourceMetadata.intendedSourceRole ?? "context", sourceRelevance: assessment.relevance ?? "adjacent", qualityClass: assessment.qualityClass ?? "context_source", evidenceType: item.evidenceType, scope: scope.type ?? "unknown", canonicalSourceIdentity: item.sourceSnapshot.source.canonicalKey };
        });
        const substantive = evidencePackets.filter((item) => item.sourceRelevance === "direct" && item.scope !== "metadata_only");
        const independentDirectSources = new Set(substantive.map((item) => item.canonicalSourceIdentity)).size;
        const primaryEvidencePresent = substantive.some((item) => item.sourceRole === "primary");
        const analyticalIntent = planSnapshot?.intentType === "trend" || planSnapshot?.intentType === "comparison" || planSnapshot?.intentType === "literature_review" || planSnapshot?.intentType === "technical_review";
        const fallbackDecision = deterministicEvaluatorDecision({ intentType: planSnapshot?.intentType, evidence: evidencePackets });
        let decision = fallbackDecision;
        const canEvaluateQuestion = question.evaluateAttempts < limits.maxQuestionEvaluateAttempts;
        if (canEvaluateQuestion && state.modelCalls < researchLimits.modelCalls && hasResearchModelCallBudget({ limits: researchLimits, totalTokens: state.totalTokens, costCredits: state.costCredits, estimateTokens: researchCallEstimate(state, "research.evaluator", researchLimits) })) {
          const evaluatorResult = await runResearchModelStage<ResearchEvaluatorDecision>({
            role: "research.evaluator",
            userId: context.execution.userId,
            conversationId: context.execution.conversationId,
            projectId: run.workspace.projectId,
            signal: context.signal,
            modelOverride,
            prompt: buildEvaluatorPrompt({ plan: planSnapshot!, question: { question: question.question, completionCriteria: question.completionCriteria }, domainProfile, evidence: evidencePackets, methodology: methodology("evaluator") }),
          });
          recordResearchModelStage(state, evaluatorResult, { estimateRole: "research.evaluator" });
          decision = normalizeResearchEvaluatorDecision(evaluatorResult.value, fallbackDecision);
        }
        const status = substantive.length === 0
          ? "unresolved"
          : (!primaryEvidencePresent || (analyticalIntent && independentDirectSources < 3)) && decision.status === "resolved"
            ? "partially_resolved"
            : decision.status;
        const sourceKinds = question.evidence.map((item) => item.sourceSnapshot.source.kind);
        const independentSourceCount = new Set(question.evidence.map((item) => item.sourceSnapshot.source.id)).size;
        const sourceQuality = question.evidence.length > 0
          ? question.evidence.reduce((sum, item) => {
              const metadata = item.sourceSnapshot.source.metadata && typeof item.sourceSnapshot.source.metadata === "object" ? item.sourceSnapshot.source.metadata as Record<string, unknown> : {};
              const signal = academicCitationSignal({
                citationCount: typeof metadata.citationCount === "number" ? metadata.citationCount : null,
                influentialCitationCount: typeof metadata.influentialCitationCount === "number" ? metadata.influentialCitationCount : null,
                fwci: typeof metadata.fwci === "number" ? metadata.fwci : null,
              });
              return sum + clampQuality(estimateSourceQuality(item.sourceSnapshot.source.kind) + (signal ?? 0));
            }, 0) / question.evidence.length
          : 0;
        const quality = summarizeResearchQuality({
          sourceQuality,
          evidenceDirectness: decision.directness,
          independentCorroboration: Math.min(1, independentSourceCount / 2),
          sourceDiversity: computeSourceDiversity(sourceKinds),
          conflict: decision.status === "controversial" ? 1 : 0,
          coverage: decision.coverage,
          recency: computeEvidenceRecency(question.evidence.map((item) => item.sourceSnapshot.retrievedAt)),
        });
        evaluatedStatuses.set(question.id, status as ResearchQuestionStatus);
        await prisma.researchQuestion.update({ where: { id: question.id }, data: { status, evaluateAttempts: canEvaluateQuestion ? { increment: 1 } : undefined, qualitySummary: json({ coverage: decision.coverage, directness: decision.directness, criterionCoverage: decision.criterionCoverage ?? [], independentSourceCount: decision.independentSourceCount ?? independentDirectSources, primaryEvidencePresent: decision.primaryEvidencePresent ?? primaryEvidencePresent, conflictState: decision.conflictState ?? "none", gap: decision.gap, followUpQueries: decision.followUpQueries ?? [], stopReason: decision.stopReason ?? fallbackDecision.stopReason, conflictReviewed: true, dimensions: quality, evaluationBudgetExhausted: !canEvaluateQuestion }) } });
        if (question.priority === "critical" && (status === "unresolved" || status === "controversial")) unresolvedCritical = question;
        await appendPublicEvent(context, { key: `research:question:evaluated:${question.id}:${state.replanCount}`, kind: "question_evaluated", runId: run.id, message: `${question.title}：${status === "resolved" ? "已解决" : status === "partially_resolved" ? "部分解决" : "未解决"}`, publicData: { questionId: question.id, status, evidenceCount: question.evidence.length } });
      }
      const allEvidence = questions.flatMap((question) => question.evidence);
      const semanticCoverage = questions.length === 0 ? 0 : [...evaluatedStatuses.values()].filter((status) => status === "resolved").length / questions.length;
      const sourceDiversity = computeSourceDiversity(allEvidence.map((evidence) => evidence.sourceSnapshot.source.kind));
      const independentCorroboration = questions.length === 0 ? 0 : questions.filter((question) => new Set(question.evidence.map((evidence) => evidence.sourceSnapshot.source.id)).size >= 2).length / questions.length;
      const conflictCoverage = questions.length === 0 ? 0 : questions.filter((question) => question.evidence.length > 0 && evaluatedStatuses.has(question.id)).length / questions.length;
      const informationGain = computeResearchInformationGain(state.lastEvidenceCount ?? 0, allEvidence.length);
      state.lastEvidenceCount = allEvidence.length;
      const stopDecision = evaluateResearchStop({ limits: researchLimits, modelCalls: state.modelCalls, totalTokens: state.totalTokens, costCredits: state.costCredits, searchCalls: state.searchCalls, fetchCalls: state.fetchCalls, sourceCount: state.sourceCount, elapsedMs: Date.now() - (run.startedAt ?? run.createdAt).getTime(), criticalQuestionsResolved: !unresolvedCritical, semanticCoverage, sourceDiversity, independentCorroboration, conflictCoverage, informationGain, hasPendingCriticalWork: Boolean(unresolvedCritical) });
      lastBudgetStopReason = stopDecision.reason;
      state.budgetStopReason = lastBudgetStopReason;
      await appendPublicEvent(context, { key: `research:budget:evaluated:${run.id}:${state.replanCount}`, kind: "budget_updated", runId: run.id, message: stopDecision.summary, publicData: { ...stopDecision, semanticCoverage, sourceDiversity, independentCorroboration, conflictCoverage, informationGain, counters: { modelCalls: state.modelCalls, promptTokens: state.promptTokens ?? 0, completionTokens: state.completionTokens ?? 0, totalTokens: state.totalTokens ?? 0, costCredits: state.costCredits ?? 0, searchCalls: state.searchCalls, fetchCalls: state.fetchCalls, sourceCount: state.sourceCount } } });
      if (!stopDecision.stop && unresolvedCritical && unresolvedCritical.replanAttempts < limits.maxQuestionReplans && state.replanCount < limits.maxReplans && state.searchCalls < limits.searchCalls) {
        state.replanCount += 1;
        await prisma.researchQuestion.update({ where: { id: unresolvedCritical.id }, data: { replanAttempts: { increment: 1 } } });
        await prisma.researchTask.create({ data: { runId: run.id, questionId: unresolvedCritical.id, kind: "replanner", priority: "critical", title: `补充研究：${unresolvedCritical.title}`, instructions: `针对未解决问题补充独立来源：${unresolvedCritical.question}`, idempotencyKey: `${run.id}:${unresolvedCritical.key}:replan:${state.replanCount}` } });
        state.stage = "researching";
        await transitionRun(run.id, "researching");
      } else if (!state.citationExpansion?.done) {
        // Citation Graph v1：Claim Extraction 之前先做一次有界的 scholarly graph
        // expansion（run.status 保持 evaluating）；完成后回到 evaluating 用扩充后
        // 的 Evidence 重新评估，再进入 Claim Extraction。
        state.stage = "citation_expansion";
      } else if (!state.visualEvidence?.done) {
        // Visual Evidence v1：只在问题确实指向图表定量结果时，做一次有硬预算的
        // 图表读取与多模态观察；run.status 保持 evaluating，观察仍要走 Claim
        // Extraction → Relation → Verification。
        state.stage = "visual_evidence";
      } else {
        // Claim Graph v1：评估结束后先进入有界的 Claim Extraction 阶段，
        // run.status 保持 evaluating，Claim Graph 落库后再推进到 synthesizing。
        state.stage = "claim_extraction";
      }
      await context.saveCheckpoint(checkpointWithResearch(checkpoint, state));
      return { kind: "rescheduled", checkpoint: checkpointWithResearch(checkpoint, state) };
    }

    if (state.stage === "citation_expansion") {
      const policy = resolveCitationGraphPolicy(run.workspace.budgetProfile, run.workspace.domainProfileKey ?? null);
      const planTimeRange = typeof (run.activePlanVersion?.plan as unknown as ResearchPlanSnapshot | undefined)?.timeRange === "string"
        ? (run.activePlanVersion?.plan as unknown as ResearchPlanSnapshot).timeRange
        : null;
      const expansionState = state.citationExpansion ?? {
        done: false,
        completedQuestionIds: [] as string[],
        fingerprints: {} as Record<string, string[]>,
        graphToolCalls: 0,
        metrics: emptyCitationGraphMetrics() as unknown as Record<string, number>,
      };
      const runTool = toolInvoker;
      const questions = await prisma.researchQuestion.findMany({
        where: { runId: run.id },
        include: { evidence: { where: { status: "active" }, include: { sourceSnapshot: { include: { source: true } } } } },
        orderBy: { orderIndex: "asc" },
      });
      for (const question of questions) {
        if (context.signal.aborted) break;
        if (expansionState.completedQuestionIds.includes(question.id)) continue;
        if (!policy.enabled) {
          expansionState.completedQuestionIds.push(question.id);
          continue;
        }
        const sourceIds = new Set(question.evidence.map((evidence) => evidence.sourceSnapshot.sourceId));
        const decision = decideCitationExpansion({
          questionStatus: question.status,
          questionText: question.question,
          activeEvidenceCount: question.evidence.length,
          independentSourceCount: sourceIds.size,
          timeRange: planTimeRange,
          maxRelations: policy.maxRelationsPerSeed,
        });
        if (!decision.needed) {
          expansionState.completedQuestionIds.push(question.id);
          continue;
        }
        // Seed：该 Question 已 fetch 的 scholarly ResearchSource（按确定性评分排序）。
        const seedBySourceId = new Map<string, GraphSeedInput>();
        for (const evidence of question.evidence) {
          const source = evidence.sourceSnapshot.source;
          if (seedBySourceId.has(source.id)) continue;
          const metadata = source.metadata && typeof source.metadata === "object" && !Array.isArray(source.metadata) ? source.metadata as Record<string, unknown> : {};
          const provider = typeof metadata.provider === "string" ? metadata.provider : null;
          seedBySourceId.set(source.id, {
            sourceId: source.id,
            canonicalKey: source.canonicalKey,
            kind: source.kind,
            title: source.title,
            doi: source.doi,
            sciverseUniqueId: provider === "sciverse" && typeof metadata.uniqueId === "string" ? metadata.uniqueId : null,
            isContentAccessible: metadata.isContentAccessible === true,
            activeEvidenceCount: 0,
            year: typeof metadata.year === "number" ? metadata.year : null,
            citationCount: typeof metadata.citationCount === "number" ? metadata.citationCount : null,
            influentialCitationCount: typeof metadata.influentialCitationCount === "number" ? metadata.influentialCitationCount : null,
            fwci: typeof metadata.fwci === "number" ? metadata.fwci : null,
          });
        }
        for (const evidence of question.evidence) {
          const seed = seedBySourceId.get(evidence.sourceSnapshot.sourceId);
          if (seed) seed.activeEvidenceCount += 1;
        }
        const seeds = selectGraphSeeds([...seedBySourceId.values()], policy);
        if (seeds.length === 0) {
          expansionState.completedQuestionIds.push(question.id);
          continue;
        }
        // Seed 缺 Sciverse uniqueId 时做有界 identity resolution（一次精确 DOI 检索）；
        // 解析失败的 seed 直接放弃，graph 是增强路径，不影响既有 Evidence。
        const resolvedSeeds: GraphSeedInput[] = [];
        for (const seed of seeds) {
          if (expansionState.graphToolCalls >= policy.maxGraphToolCallsPerRun) break;
          if (seed.sciverseUniqueId) {
            resolvedSeeds.push(seed);
            continue;
          }
          if (!tryReserveResearchBudgetCounter(state, researchLimits, "searchCalls")) break;
          expansionState.graphToolCalls += 1;
          const uniqueId = await resolveSeedSciverseUniqueId(runTool, providerContext, seed);
          if (uniqueId) resolvedSeeds.push({ ...seed, sciverseUniqueId: uniqueId });
        }
        if (resolvedSeeds.length === 0) {
          expansionState.completedQuestionIds.push(question.id);
          continue;
        }
        const questionContext: ResearchProviderContext = { ...providerContext, question: question.question };
        const output = await expandCitationGraphForQuestion({
          userId: context.execution.userId,
          workspaceId: run.workspaceId,
          runId: run.id,
          questionId: question.id,
          questionText: question.question,
          seeds: resolvedSeeds,
          relations: decision.relations,
          policy,
          providerContext: questionContext,
          provider,
          runTool,
          processedFingerprints: new Set(expansionState.fingerprints[question.id] ?? []),
          graphToolCallsUsed: expansionState.graphToolCalls,
          tryReserve: (counter) => tryReserveResearchBudgetCounter(state, researchLimits, counter),
          ingest: ingestResearchReadSource,
        });
        expansionState.fingerprints[question.id] = [...(expansionState.fingerprints[question.id] ?? []), ...output.processedFingerprints];
        expansionState.graphToolCalls = output.graphToolCallsUsed;
        for (const [key, value] of Object.entries(output.metrics)) {
          expansionState.metrics[key] = (expansionState.metrics[key] ?? 0) + value;
        }
        expansionState.completedQuestionIds.push(question.id);
        await appendPublicEvent(context, {
          key: `research:citation-expansion:${question.id}`,
          kind: "source_candidate_discovered",
          runId: run.id,
          message: `引用图扩展：${question.title}（${decision.reason}）`,
          publicData: {
            questionId: question.id,
            needs: decision.needs,
            relations: decision.relations,
            ...output.metrics,
          },
        });
        state.citationExpansion = expansionState;
        await context.saveCheckpoint(checkpointWithResearch(checkpoint, state));
      }
      expansionState.done = true;
      state.citationExpansion = expansionState;
      // 回到 evaluating 用扩充后的 Evidence 重新评估；claim extraction 的
      // evidence fingerprint 自然变化，只重算受影响 Question。
      state.stage = "evaluating";
      await context.saveCheckpoint(checkpointWithResearch(checkpoint, state));
      await appendPublicEvent(context, {
        key: `research:stage:citation_expansion:${run.id}`,
        kind: "stage_changed",
        runId: run.id,
        message: "引用图扩展完成，重新评估后进入命题提炼",
        publicData: { metrics: expansionState.metrics, graphToolCalls: expansionState.graphToolCalls },
      });
      return { kind: "rescheduled", checkpoint: checkpointWithResearch(checkpoint, state) };
    }

    if (state.stage === "visual_evidence") {
      // 视觉阶段使用完整限额：发现阶段已经把它的份额预留出来了。
      const policy = visualPolicyForReserve;
      const visualState = state.visualEvidence ?? {
        done: false,
        completedQuestionIds: [] as string[],
        fingerprints: {} as Record<string, string>,
        metrics: emptyVisualEvidenceMetrics() as unknown as Record<string, number>,
      };
      const metrics = visualState.metrics as unknown as ReturnType<typeof emptyVisualEvidenceMetrics>;
      const questions = await prisma.researchQuestion.findMany({
        where: { runId: run.id },
        include: {
          evidence: { where: { status: "active" }, include: { sourceSnapshot: { include: { source: true } } }, orderBy: { createdAt: "asc" } },
        },
        orderBy: [{ priority: "asc" }, { orderIndex: "asc" }],
      });

      interface SelectedVisualQuestion {
        questionId: string;
        questionText: string;
        title: string;
        fingerprint: string;
        source: { canonicalKey: string; docId: string; contentHash: string; snapshotId: string; title: string };
        refs: ResearchResourceRef[];
        bodyContext: string;
        evidenceIds: string[];
      }
      const selected: SelectedVisualQuestion[] = [];

      for (const question of questions) {
        if (context.signal.aborted) break;
        if (visualState.completedQuestionIds.includes(question.id)) continue;
        metrics.questionsConsidered += 1;
        // 只有 sciverse 全文 chunk 证据才可能携带图表资源；metadata-only 证据
        // 既不能支撑视觉分析，也不能被当成“已读全文”。
        const fullTextEvidence = question.evidence.filter((evidence) => {
          const scope = evidence.sourceSnapshot.metadata && typeof evidence.sourceSnapshot.metadata === "object"
            ? (evidence.sourceSnapshot.metadata as Record<string, unknown>).scope
            : null;
          const scopeType = scope && typeof scope === "object" ? (scope as Record<string, unknown>).type : null;
          return scopeType === "bounded_evidence_slices";
        });
        const need = decideVisualEvidenceNeed({
          questionText: question.question,
          completionCriteria: Array.isArray(question.completionCriteria)
            ? question.completionCriteria.filter((item): item is string => typeof item === "string")
            : [],
          status: question.status,
          fullTextEvidenceCount: fullTextEvidence.length,
        });
        if (!need.needed) {
          visualState.completedQuestionIds.push(question.id);
          continue;
        }
        const evidenceIds = question.evidence.map((evidence) => evidence.id);
        const fingerprint = buildVisualEvidenceFingerprint({ evidenceIds, status: question.status });
        if (visualState.fingerprints[question.id] === fingerprint) {
          visualState.completedQuestionIds.push(question.id);
          continue;
        }
        // 每个来源（canonical ResearchSource）最多取一次；多 chunk 不等于多来源。
        const bySource = new Map<string, typeof fullTextEvidence[number]>();
        for (const evidence of fullTextEvidence) {
          if (!bySource.has(evidence.sourceSnapshot.sourceId)) bySource.set(evidence.sourceSnapshot.sourceId, evidence);
        }
        const primary = [...bySource.values()].find((evidence) => {
          const metadata = evidence.sourceSnapshot.source.metadata;
          const record = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata as Record<string, unknown> : {};
          return typeof record.docId === "string" && record.docId.length > 0;
        });
        if (!primary) {
          visualState.completedQuestionIds.push(question.id);
          continue;
        }
        const sourceMetadata = primary.sourceSnapshot.source.metadata && typeof primary.sourceSnapshot.source.metadata === "object"
          ? primary.sourceSnapshot.source.metadata as Record<string, unknown>
          : {};
        const docId = typeof sourceMetadata.docId === "string" ? sourceMetadata.docId : "";
        if (!docId) {
          visualState.completedQuestionIds.push(question.id);
          continue;
        }
        // 已发现的图表引用（来自正文读取时确定性解析）。
        const refs: ResearchResourceRef[] = [];
        const seenRefs = new Set<string>();
        for (const evidence of fullTextEvidence) {
          if (evidence.sourceSnapshot.sourceId !== primary.sourceSnapshot.sourceId) continue;
          const provenance = evidence.provenance && typeof evidence.provenance === "object" && !Array.isArray(evidence.provenance)
            ? evidence.provenance as Record<string, unknown>
            : {};
          for (const ref of parseResearchResourceRefs(provenance.resourceRefs)) {
            if (seenRefs.has(ref.fileName)) continue;
            seenRefs.add(ref.fileName);
            refs.push(ref);
          }
        }
        // 图表通常不在证据 chunk 附近：允许一次有界图表扫描读取（预算内）。
        if (refs.length === 0 && policy.maxFigureScanReads > 0 && metrics.figureScanReads < policy.maxFigureScanReads) {
          const documentLength = fullTextEvidence
            .map((evidence) => {
              const provenance = evidence.provenance && typeof evidence.provenance === "object" && !Array.isArray(evidence.provenance)
                ? evidence.provenance as Record<string, unknown>
                : {};
              return typeof provenance.documentLength === "number" ? provenance.documentLength : null;
            })
            .find((value): value is number => value !== null) ?? null;
          const offsets = documentLength && documentLength > VISUAL_SCAN_WINDOW
            ? [0, Math.max(0, Math.floor(documentLength / 2) - Math.floor(VISUAL_SCAN_WINDOW / 2))]
            : [0];
          for (const offset of offsets) {
            if (context.signal.aborted) break;
            if (metrics.figureScanReads >= policy.maxFigureScanReads) break;
            if (!tryReserveResearchBudgetCounter(state, limits, "fetchCalls")) {
              metrics.budgetStops += 1;
              break;
            }
            metrics.figureScanReads += 1;
            const scan = await toolInvoker(providerContext, "sciverse.read", { docId, offset, limit: VISUAL_SCAN_WINDOW });
            if (!scan || typeof scan !== "object" || "error" in scan) {
              metrics.degradations += 1;
              continue;
            }
            for (const ref of parseResearchResourceRefs((scan as Record<string, unknown>).resources)) {
              if (seenRefs.has(ref.fileName)) continue;
              seenRefs.add(ref.fileName);
              refs.push(ref);
            }
            if (refs.length > 0) break;
          }
        }
        if (refs.length === 0) {
          visualState.completedQuestionIds.push(question.id);
          visualState.fingerprints[question.id] = fingerprint;
          continue;
        }
        if (selected.length >= policy.maxQuestions) {
          metrics.budgetStops += 1;
          visualState.completedQuestionIds.push(question.id);
          continue;
        }
        selected.push({
          questionId: question.id,
          questionText: question.question,
          title: question.title,
          fingerprint,
          source: {
            canonicalKey: primary.sourceSnapshot.source.canonicalKey,
            docId,
            contentHash: primary.sourceSnapshot.contentHash,
            snapshotId: primary.sourceSnapshotId,
            title: primary.sourceSnapshot.source.title ?? question.title,
          },
          refs: refs.slice(0, policy.maxResourcesPerQuestion),
          bodyContext: fullTextEvidence.map((evidence) => evidence.excerpt).join("\n").slice(0, VISUAL_BODY_CONTEXT_CHARS),
          evidenceIds,
        });
        metrics.questionsSelected += 1;
      }

      for (const item of selected) {
        if (context.signal.aborted) break;
        if (metrics.modelCalls >= policy.maxModelCalls) {
          metrics.budgetStops += 1;
          break;
        }
        const resources: VisualResourceForPersistence[] = [];
        for (const [index, ref] of item.refs.entries()) {
          if (metrics.resourceFetches >= policy.maxResourceFetches) {
            metrics.budgetStops += 1;
            break;
          }
          if (!tryReserveResearchBudgetCounter(state, limits, "fetchCalls")) {
            metrics.budgetStops += 1;
            break;
          }
          metrics.resourceFetches += 1;
          const resource = await toolInvoker(providerContext, "sciverse.resource", { fileName: ref.fileName, docId: item.source.docId });
          const payload = resource && typeof resource === "object" && !("error" in resource) ? resource as Record<string, unknown> : null;
          const dataBase64 = payload && typeof payload.dataBase64 === "string" ? payload.dataBase64 : null;
          const mimeType = payload && typeof payload.mimeType === "string" ? payload.mimeType : "";
          if (!payload || payload.dataIncluded !== true || !dataBase64 || !mimeType.startsWith("image/")) {
            // 资源不可得/非图片/超限：降级继续正文 Evidence，不失败整个 Run。
            metrics.degradations += 1;
            degradationCodes.add("visual_resources_unavailable");
            continue;
          }
          const bytes = Buffer.from(dataBase64, "base64");
          if (bytes.length === 0 || bytes.length > VISUAL_EVIDENCE_MAX_IMAGE_BYTES) {
            metrics.degradations += 1;
            continue;
          }
          resources.push({
            resourceId: `r${index + 1}`,
            fileName: ref.fileName,
            kind: ref.kind,
            mimeType,
            bytes,
            ...(ref.alt ? { alt: ref.alt } : {}),
            ...(ref.context ? { caption: ref.context } : {}),
          });
        }
        if (resources.length === 0) {
          visualState.completedQuestionIds.push(item.questionId);
          visualState.fingerprints[item.questionId] = item.fingerprint;
          state.visualEvidence = visualState;
          await context.saveCheckpoint(checkpointWithResearch(checkpoint, state));
          continue;
        }

        if (!tryReserveResearchBudgetCounter(state, researchLimits, "modelCalls")) {
          metrics.budgetStops += 1;
          break;
        }
        const promptResources: VisualAnalysisResourceInput[] = resources.map((resource) => ({
          resourceId: resource.resourceId,
          kind: resource.kind,
          ...(resource.alt ? { alt: resource.alt } : {}),
          ...(resource.caption ? { caption: resource.caption } : {}),
        }));
        const stage = await runResearchModelStage<{ observations?: unknown }>({
          role: "research.visual_evaluator",
          userId: context.execution.userId,
          conversationId: context.execution.conversationId,
          projectId: run.workspace.projectId,
          signal: context.signal,
          modelOverride,
          prompt: buildVisualEvidencePrompt({ question: item.questionText, resources: promptResources, bodyContext: item.bodyContext }),
          attachments: resources.map((resource) => ({
            name: resource.fileName.split("/").pop() || "figure",
            mimeType: resource.mimeType,
            size: resource.bytes.length,
            data: resource.bytes,
          })),
        });
        metrics.modelCalls += 1;
        recordResearchModelStage(state, stage, { modelCallReserved: true, estimateRole: "research.visual_evaluator" });
        if (!stage.value) {
          metrics.degradations += 1;
          degradationCodes.add("visual_model_unavailable");
          visualState.completedQuestionIds.push(item.questionId);
          visualState.fingerprints[item.questionId] = item.fingerprint;
          state.visualEvidence = visualState;
          await context.saveCheckpoint(checkpointWithResearch(checkpoint, state));
          continue;
        }
        const normalized = normalizeVisualObservationOutput(stage.value, new Set(resources.map((resource) => resource.resourceId)));
        metrics.observationsRejected += normalized.rejected;
        if (normalized.observations.length > 0) {
          const persisted = await persistVisualObservations({
            userId: context.execution.userId,
            workspaceId: run.workspaceId,
            runId: run.id,
            questionId: item.questionId,
            sourceSnapshotId: item.source.snapshotId,
            canonicalKey: item.source.canonicalKey,
            snapshotContentHash: item.source.contentHash,
            analysisModel: stage.model,
            resources,
            observations: normalized.observations,
          });
          metrics.observationsPersisted += persisted.length;
          metrics.resourcesPersisted += resources.length;
        }
        visualState.completedQuestionIds.push(item.questionId);
        visualState.fingerprints[item.questionId] = item.fingerprint;
        state.visualEvidence = visualState;
        await context.saveCheckpoint(checkpointWithResearch(checkpoint, state));
        await appendPublicEvent(context, {
          key: `research:visual:${item.questionId}`,
          kind: "evidence_extracted",
          runId: run.id,
          message: `已从论文图表补充 ${normalized.observations.length} 条视觉观察：${item.title}`,
          publicData: {
            questionId: item.questionId,
            resourceCount: resources.length,
            observationCount: normalized.observations.length,
            rejected: normalized.rejected,
          },
        });
      }

      visualState.done = true;
      state.visualEvidence = visualState;
      state.degradations = [...degradationCodes].slice(0, MAX_RESEARCH_DEGRADATIONS);
      state.stage = "claim_extraction";
      await context.saveCheckpoint(checkpointWithResearch(checkpoint, state));
      await appendPublicEvent(context, {
        key: `research:stage:visual_evidence:${run.id}`,
        kind: "stage_changed",
        runId: run.id,
        message: policy.enabled && metrics.observationsPersisted > 0
          ? `图表视觉证据完成（${metrics.observationsPersisted} 条观察），进入命题提炼`
          : "本轮未使用图表视觉证据，进入命题提炼",
        publicData: { ...metrics, enabled: policy.enabled },
      });
      return { kind: "rescheduled", checkpoint: checkpointWithResearch(checkpoint, state) };
    }

    if (state.stage === "claim_extraction") {
      const questions = await prisma.researchQuestion.findMany({
        where: { runId: run.id },
        include: { evidence: { where: { status: "active" }, include: { sourceSnapshot: { include: { source: true } } }, orderBy: { createdAt: "asc" } } },
        orderBy: { orderIndex: "asc" },
      });
      const fingerprints = { ...(state.claimExtraction?.fingerprints ?? {}) };
      let extractedQuestions = 0;
      for (const question of questions) {
        if (context.signal.aborted) break;
        const fingerprint = buildQuestionEvidenceFingerprint(question.evidence);
        if (fingerprints[question.id] === fingerprint) continue;
        const evidenceSourceById = new Map(question.evidence.map((evidence) => [evidence.id, evidence.sourceSnapshot.sourceId]));
        if (question.evidence.length === 0) {
          // 空证据集合不需要模型调用；persist 的 supersede pass 会安全处理失去依据的旧 system Claim。
          await persistExtractedClaimsForQuestion({ workspaceId: run.workspaceId, runId: run.id, question: { id: question.id, key: question.key }, claims: [], evidenceSourceById });
          fingerprints[question.id] = fingerprint;
          continue;
        }
        if (!hasResearchModelCallBudget({ limits, totalTokens: state.totalTokens, costCredits: state.costCredits, estimateTokens: researchCallEstimate(state, "research.claim_extractor", limits) }) || !tryReserveResearchBudgetCounter(state, limits, "modelCalls")) {
          // 预算耗尽：保守继续，保留既有 Claims，不追加无上限的模型调用。
          await appendPublicEvent(context, { key: `research:claims:budget:${run.id}`, kind: "budget_updated", runId: run.id, message: "模型预算已用尽，跳过剩余问题的 Claim Extraction，报告将以证据级保守方式生成", publicData: { modelCalls: state.modelCalls } });
          break;
        }
        const extractorResult = await runResearchModelStage<ClaimExtractorDecision>({
          role: "research.claim_extractor",
          userId: context.execution.userId,
          conversationId: context.execution.conversationId,
          projectId: run.workspace.projectId,
          signal: context.signal,
          modelOverride,
          prompt: buildClaimExtractionPrompt({
            question: { key: question.key, title: question.title, question: question.question, completionCriteria: question.completionCriteria },
            domainProfile,
            evidence: question.evidence.map((evidence) => ({
              id: evidence.id,
              statement: evidence.statement,
              excerpt: capEvidenceExcerpt(evidence.excerpt, EVIDENCE_EXCERPT_CAPS.claimExtractor),
              evidenceType: evidence.evidenceType,
              locator: evidence.locator,
              provenance: evidence.provenance,
              source: {
                canonicalKey: evidence.sourceSnapshot.source.canonicalKey,
                title: evidence.sourceSnapshot.source.title,
                kind: evidence.sourceSnapshot.source.kind,
                provider: evidence.sourceSnapshot.metadata && typeof evidence.sourceSnapshot.metadata === "object" && typeof (evidence.sourceSnapshot.metadata as Record<string, unknown>).provider === "string" ? (evidence.sourceSnapshot.metadata as Record<string, unknown>).provider as string : null,
                doi: evidence.sourceSnapshot.source.doi,
                canonicalUrl: evidence.sourceSnapshot.source.canonicalUrl,
              },
            })),
            methodology: methodology("claim"),
          }),
        });
        recordResearchModelStage(state, extractorResult, { modelCallReserved: true, estimateRole: "research.claim_extractor" });
        if (!extractorResult.value) {
          // 模型不可用或 JSON 解析失败：不回退到模板 Claim，留下可观测状态并保守继续。
          await appendPublicEvent(context, { key: `research:claims:unavailable:${question.id}:${context.execution.attempt}`, kind: "question_evaluated", runId: run.id, message: `Claim Extraction 暂不可用：${question.title}，本 Run 将以证据级保守方式继续`, publicData: { questionId: question.id, modelAttempted: extractorResult.attempted } });
          continue;
        }
        const decision = normalizeClaimExtractorOutput(extractorResult.value, new Set(question.evidence.map((evidence) => evidence.id)));
        const stats = await persistExtractedClaimsForQuestion({ workspaceId: run.workspaceId, runId: run.id, question: { id: question.id, key: question.key }, claims: decision.claims, evidenceSourceById });
        fingerprints[question.id] = fingerprint;
        extractedQuestions += 1;
        await appendPublicEvent(context, { key: `research:claims:extracted:${question.id}:${fingerprints[question.id].slice(0, 12)}`, kind: "evidence_extracted", runId: run.id, message: `已从 ${question.evidence.length} 条 Evidence 提炼 ${decision.claims.length} 个原子 Claim：${question.title}`, publicData: { questionId: question.id, evidenceCount: question.evidence.length, claimCount: decision.claims.length, created: stats.created, updated: stats.updated, superseded: stats.superseded, skippedUserEdited: stats.skippedUserEdited } });
        state.claimExtraction = { fingerprints };
        await context.saveCheckpoint(checkpointWithResearch(checkpoint, state));
      }
      state.claimExtraction = { fingerprints };
      state.stage = "verifying";
      await transitionRun(run.id, "verifying");
      await context.saveCheckpoint(checkpointWithResearch(checkpoint, state));
      await appendPublicEvent(context, { key: "research:stage:claim_extraction", kind: "stage_changed", runId: run.id, message: "Claim Extraction 完成，先核验命题再组织报告", publicData: { extractedQuestions, questionCount: questions.length } });
      return { kind: "rescheduled", checkpoint: checkpointWithResearch(checkpoint, state) };
    }

    if (state.stage === "synthesizing") {
      // Compatibility for checkpoints created before verify-before-synthesize.
      // Never emit the former deterministic bullet fallback; resume at Claim verification.
      state.stage = "verifying";
      await transitionRun(run.id, "verifying");
      await context.saveCheckpoint(checkpointWithResearch(checkpoint, state));
      await appendPublicEvent(context, { key: "research:synthesis:legacy-resume", kind: "stage_changed", runId: run.id, message: "已切换为先核验命题、再组织报告的收尾流程" });
      return { kind: "rescheduled", checkpoint: checkpointWithResearch(checkpoint, state) };
    }

    const existingReport = await prisma.researchReportSnapshot.findUnique({ where: { runId: run.id } });
    if (existingReport) return { kind: "completed", checkpoint };
    const finalizationStart = { modelCalls: state.modelCalls, totalTokens: state.totalTokens ?? 0, costCredits: state.costCredits ?? 0 };
    // 收尾调用跳过的归因：走不到各 if 分支只可能是预算问题（token/credit 触顶、
    // modelCalls 计数打满，或余量不足以安全覆盖「上次同阶段实测 × 安全系数」）；
    // 模型不可用是 if 分支内 attempted 但 value 为 null。两种原因分开记降级码。
    const canUseFinalizationModel = (role: "research.verifier" | "research.report_architect" | "research.synthesizer" | "research.report_auditor") =>
      (state.totalTokens ?? 0) < limits.maxTokens
      && (state.costCredits ?? 0) < limits.maxCostCredits
      && hasResearchModelCallBudget({ limits, totalTokens: state.totalTokens, costCredits: state.costCredits, estimateTokens: researchCallEstimate(state, role, limits) });
    const claims = await prisma.claim.findMany({ where: { runId: run.id, status: { in: ["active", "disputed"] } }, include: { question: { select: { id: true, title: true, question: true, priority: true } }, evidenceRelations: { include: { evidence: { include: { sourceSnapshot: { include: { source: true } } } } } } }, orderBy: { createdAt: "asc" } });
    const evidence = await prisma.evidence.findMany({ where: { runId: run.id, status: "active" }, include: { sourceSnapshot: { include: { source: true } } }, orderBy: { createdAt: "asc" } });
    const sourceSnapshots = [...new Set(evidence.map((item) => item.sourceSnapshotId))];
    const canonicalSourceCount = new Set(evidence.map((item) => item.sourceSnapshot.sourceId)).size;
    // Claim Graph v1：先做 deterministic 证据结构下界，再让 model verifier 在下界之内审查。
    const deterministicByClaim = new Map(claims.map((claim) => [claim.id, computeDeterministicClaimVerification(claim.evidenceRelations.map((relation) => ({
      relation: relation.relation,
      evidence: {
        status: relation.evidence.status,
        evidenceType: relation.evidence.evidenceType,
        snapshotScopeType: snapshotScopeTypeOf(relation.evidence.sourceSnapshot.metadata),
        sourceSnapshot: { sourceId: relation.evidence.sourceSnapshot.sourceId },
      },
    })))]));
    let verifierDecision: ResearchVerifierDecision = { claims: {} };
    // Citation Graph：统计每个 Claim 的支持来源之间存在直接引用边的数量。
    // 有引用关系不自动等于不独立（后续论文引用原论文仍可能提供独立实验），
    // 只作为 verifier 的来源独立性风险信号。
    const citationEdges = await prisma.researchSourceRelation.findMany({
      where: { runId: run.id, targetSourceId: { not: null } },
      select: { sourceId: true, targetSourceId: true },
    });
    const linkedPairs = new Set(citationEdges.flatMap((edge) => [`${edge.sourceId}->${edge.targetSourceId}`, `${edge.targetSourceId}->${edge.sourceId}`]));
    const citationLinkedCountByClaim = new Map(claims.map((claim) => {
      const sourceIds = [...new Set(claim.evidenceRelations.filter((relation) => relation.evidence.status === "active").map((relation) => relation.evidence.sourceSnapshot.sourceId))];
      let linked = 0;
      for (let i = 0; i < sourceIds.length; i += 1) {
        for (let j = i + 1; j < sourceIds.length; j += 1) {
          if (linkedPairs.has(`${sourceIds[i]}->${sourceIds[j]}`)) linked += 1;
        }
      }
      return [claim.id, linked] as const;
    }));
    let verifierAvailable = false;
    if (canUseFinalizationModel("research.verifier") && tryReserveResearchBudgetCounter(state, limits, "modelCalls")) {
      const verifierResult = await runResearchModelStage<ResearchVerifierDecision>({
        role: "research.verifier",
        userId: context.execution.userId,
        conversationId: context.execution.conversationId,
        projectId: run.workspace.projectId,
        signal: context.signal,
        modelOverride,
        prompt: buildVerifierPrompt({ plan: planSnapshot!, domainProfile, claims: claims.map((claim) => ({
            id: claim.id,
            statement: claim.statement,
            deterministicPrecheck: { status: deterministicByClaim.get(claim.id)?.status, reasonCode: deterministicByClaim.get(claim.id)?.reasonCode },
            citationLinkedSourceCount: citationLinkedCountByClaim.get(claim.id) ?? 0,
            relations: claim.evidenceRelations.map((relation) => ({
              relation: relation.relation,
              confidence: relation.confidence,
              rationale: relation.rationale,
              evidenceStatus: relation.evidence.status,
              statement: relation.evidence.statement,
              excerpt: capEvidenceExcerpt(relation.evidence.excerpt, EVIDENCE_EXCERPT_CAPS.verifier),
              source: {
                canonicalKey: relation.evidence.sourceSnapshot.source.canonicalKey,
                title: relation.evidence.sourceSnapshot.source.title,
                kind: relation.evidence.sourceSnapshot.source.kind,
                doi: relation.evidence.sourceSnapshot.source.doi,
                canonicalUrl: relation.evidence.sourceSnapshot.source.canonicalUrl,
              },
            })),
          })), methodology: methodology("verifier") }),
      });
      recordResearchModelStage(state, verifierResult, { modelCallReserved: true, estimateRole: "research.verifier" });
      verifierDecision = normalizeResearchVerifierDecision(verifierResult.value);
      verifierAvailable = Boolean(verifierResult.value);
      if (!verifierAvailable) degradationCodes.add("research_verifier_unavailable");
      await context.saveCheckpoint(checkpointWithResearch(checkpoint, state));
    } else {
      degradationCodes.add("finalization_budget_exhausted");
    }
    const claimStatuses = Object.fromEntries(claims.map((claim) => {
      const deterministic = deterministicByClaim.get(claim.id)!;
      return [claim.id, mergeClaimVerification({ deterministic, model: verifierDecision.claims[claim.id] })];
    }));
    const unsupportedClaims = claims.filter((claim) => claimStatuses[claim.id]?.status === "unsupported");
    const conflictedClaims = claims.filter((claim) => claimStatuses[claim.id]?.status === "conflicted");
    const qualifiedClaims = claims.filter((claim) => claimStatuses[claim.id]?.status === "needs_qualification");
    const fullCitationMap = buildResearchCitationMap(claims);
    for (const claim of claims) {
      const deterministic = deterministicByClaim.get(claim.id)!;
      const previousQuality = claim.quality && typeof claim.quality === "object" && !Array.isArray(claim.quality) ? claim.quality as Record<string, unknown> : {};
      const citationLinkedSourceCount = citationLinkedCountByClaim.get(claim.id) ?? 0;
      await prisma.claim.update({ where: { id: claim.id }, data: { verificationStatus: claimStatuses[claim.id]?.status, quality: json({ ...previousQuality, ...deterministic.quality, citationLinkedSourceCount, ...(citationLinkedSourceCount > 0 ? { independenceCaution: true } : {}), verificationReason: claimStatuses[claim.id]?.reasonCode }) } });
    }
    const repairTargets = selectVerificationRepairTargets({
      claims: claims.map((claim) => ({ id: claim.id, questionId: claim.questionId, question: claim.question ? { id: claim.question.id, title: claim.question.title, question: claim.question.question, priority: claim.question.priority } : null })),
      statuses: claimStatuses,
      maximum: limits.researcherConcurrency,
    });
    const canScheduleVerificationResearch = repairTargets.length > 0
      && state.verificationRepairs < limits.maxVerificationRepairs
      && Date.now() - (run.startedAt ?? run.createdAt).getTime() < limits.wallTimeMs
      && state.modelCalls < researchLimits.modelCalls
      && (state.totalTokens ?? 0) < researchLimits.maxTokens
      && (state.costCredits ?? 0) < researchLimits.maxCostCredits
      && state.searchCalls < researchLimits.searchCalls
      && state.fetchCalls < researchLimits.fetchCalls
      && state.sourceCount < researchLimits.maxSources;
    if (canScheduleVerificationResearch) {
      const repairIteration = state.verificationRepairs + 1;
      state.verificationRepairs = repairIteration;
      await prisma.researchTask.createMany({
        data: repairTargets.map((target) => ({
          runId: run.id,
          questionId: target.questionId,
          kind: "replanner" as const,
          priority: target.priority,
          title: `引用核验补充研究：${target.title}`,
          instructions: verificationRepairInstruction(target),
          payload: json({ repairIteration, claimIds: target.claimIds, verificationStatuses: target.statuses }),
          idempotencyKey: `${run.id}:${target.questionId}:verification-repair:${repairIteration}`,
        })),
        skipDuplicates: true,
      });
      state.stage = "researching";
      await transitionRun(run.id, "researching");
      await context.saveCheckpoint(checkpointWithResearch(checkpoint, state));
      await appendPublicEvent(context, { key: `research:verification:repair:${run.id}:${repairIteration}`, kind: "verification_updated", runId: run.id, message: "引用核验发现核心证据缺口，已创建有限补充研究任务", publicData: { repairIteration, taskCount: repairTargets.length, claimIds: repairTargets.flatMap((target) => target.claimIds), questionIds: repairTargets.map((target) => target.questionId), verificationRepairsRemaining: Math.max(0, limits.maxVerificationRepairs - repairIteration) } });
      return { kind: "rescheduled", checkpoint: checkpointWithResearch(checkpoint, state) };
    }
    const markerByEvidenceId = new Map(evidence.map((item, index) => [item.id, `E${index + 1}`]));
    const claimPackets: ReportClaimPacket[] = claims.map((claim) => {
      const quality = claim.quality && typeof claim.quality === "object" && !Array.isArray(claim.quality) ? claim.quality as Record<string, unknown> : {};
      const qualifiers = Array.isArray(quality.qualifiers) ? quality.qualifiers.filter((item): item is string => typeof item === "string").slice(0, 8) : [];
      return {
        id: claim.id,
        statement: claim.statement,
        status: claimStatuses[claim.id]?.status ?? "unsupported",
        qualifiers,
        evidence: claim.evidenceRelations.flatMap((relation) => {
          const marker = markerByEvidenceId.get(relation.evidenceId);
          if (!marker || relation.evidence.status !== "active") return [];
          const sourceMetadata = relation.evidence.sourceSnapshot.source.metadata && typeof relation.evidence.sourceSnapshot.source.metadata === "object" && !Array.isArray(relation.evidence.sourceSnapshot.source.metadata) ? relation.evidence.sourceSnapshot.source.metadata as Record<string, unknown> : {};
          const provenance = relation.evidence.provenance && typeof relation.evidence.provenance === "object" && !Array.isArray(relation.evidence.provenance) ? relation.evidence.provenance as Record<string, unknown> : {};
          return [{ marker, relation: relation.relation, statement: relation.evidence.statement, excerpt: capEvidenceExcerpt(relation.evidence.excerpt, EVIDENCE_EXCERPT_CAPS.reportPacket), source: { title: relation.evidence.sourceSnapshot.source.title, canonicalKey: relation.evidence.sourceSnapshot.source.canonicalKey, year: sourceMetadata.year ?? null, venue: sourceMetadata.venue ?? null, assessment: provenance.sourceAssessment ?? sourceMetadata.sourceAssessment ?? null } }];
        }),
      };
    });
    const reportQuestions = await prisma.researchQuestion.findMany({ where: { runId: run.id }, orderBy: { orderIndex: "asc" }, select: { id: true, key: true, title: true, question: true, priority: true, status: true, qualitySummary: true } });
    const coverageGaps = reportQuestions.flatMap((question) => {
      const quality = question.qualitySummary && typeof question.qualitySummary === "object" && !Array.isArray(question.qualitySummary) ? question.qualitySummary as Record<string, unknown> : {};
      return typeof quality.gap === "string" && quality.gap.trim() ? [quality.gap.trim().slice(0, 500)] : [];
    });
    const allowedClaimIds = new Set(claimPackets.filter((claim) => claim.status !== "unsupported").map((claim) => claim.id));
    let architecture = fallbackReportArchitecture({ objective: planSnapshot?.objective ?? run.question, intentType: planSnapshot?.intentType, claims: claimPackets });
    let architectureAvailable = false;
    if (canUseFinalizationModel("research.report_architect") && tryReserveResearchBudgetCounter(state, limits, "modelCalls")) {
      const architect = await architectReportWithExistingRuntime({ userId: context.execution.userId, conversationId: context.execution.conversationId, projectId: run.workspace.projectId, signal: context.signal, plan: planSnapshot!, questions: reportQuestions, claims: claimPackets, coverageGaps, modelOverride, methodology: methodology("report_architect") });
      recordResearchModelStage(state, architect, { modelCallReserved: true, estimateRole: "research.report_architect" });
      const normalized = normalizeReportArchitecture(architect.value, allowedClaimIds);
      if (normalized) {
        architecture = normalized;
        architectureAvailable = true;
      } else degradationCodes.add("research_report_architecture_unavailable");
    } else degradationCodes.add("finalization_budget_exhausted");

    let reportBody = "";
    let synthesisAvailable = false;
    let synthesisAttempted = false;
    if (canUseFinalizationModel("research.synthesizer") && tryReserveResearchBudgetCounter(state, limits, "modelCalls")) {
      synthesisAttempted = true;
      const writer = await writeFinalReportWithExistingRuntime({ userId: context.execution.userId, conversationId: context.execution.conversationId, projectId: run.workspace.projectId, signal: context.signal, modelOverride, plan: planSnapshot!, architecture, claims: claimPackets, profile: run.workspace.budgetProfile, methodology: methodology("writer") });
      recordResearchModelStage(state, writer, { modelCallReserved: true, estimateRole: "research.synthesizer" });
      if (writer.value) {
        reportBody = writer.value;
        synthesisAvailable = true;
      }
    }
    if (!synthesisAvailable) {
      degradationCodes.add(synthesisAttempted ? "research_synthesis_unavailable" : "finalization_budget_exhausted");
      reportBody = synthesisAttempted
        ? "## 综合阶段未完成\n\n研究资料已经收集，但最终综合阶段未成功完成。当前来源、Evidence 与 Claim 已保留，可在工作区查看或通过 Follow-up Run 重试。"
        : "## 综合阶段未执行\n\n研究预算已在资料收集阶段用尽，最终综合与核验未能执行。当前来源、Evidence 与 Claim 已保留，可改用更高研究强度重试。";
    }

    let deterministicAudit = deterministicReportAudit({ report: reportBody, evidenceRefs: evidence.map((item) => item.id), claims: claimPackets });
    const bibliographySourceIdsFor = (body: string) => [...new Set(evidenceMarkersInReport(body).flatMap((marker) => evidence[marker - 1]?.sourceSnapshot.sourceId ? [evidence[marker - 1].sourceSnapshot.sourceId] : []))];
    let modelAudit = { pass: false, issues: [] as Array<{ code: string; severity: "error" | "warning"; message: string }>, repairInstructions: [] as string[] };
    let auditorAvailable = false;
    if (canUseFinalizationModel("research.report_auditor") && tryReserveResearchBudgetCounter(state, limits, "modelCalls")) {
      const audit = await auditFinalReportWithExistingRuntime({ userId: context.execution.userId, conversationId: context.execution.conversationId, projectId: run.workspace.projectId, signal: context.signal, modelOverride, plan: planSnapshot!, architecture, claims: claimPackets, report: reportBody, bibliographySourceIds: bibliographySourceIdsFor(reportBody), methodology: methodology("auditor") });
      recordResearchModelStage(state, audit, { modelCallReserved: true, estimateRole: "research.report_auditor" });
      if (audit.value) {
        modelAudit = normalizeReportAuditDecision(audit.value);
        auditorAvailable = true;
      } else degradationCodes.add("research_report_audit_unavailable");
    } else degradationCodes.add("finalization_budget_exhausted");

    let reportAuditPass = synthesisAvailable && deterministicAudit.pass && auditorAvailable && modelAudit.pass;
    if (!reportAuditPass && synthesisAvailable && auditorAvailable && state.verificationRepairs < limits.maxVerificationRepairs && canUseFinalizationModel("research.synthesizer") && tryReserveResearchBudgetCounter(state, limits, "modelCalls")) {
      state.verificationRepairs += 1;
      const repair = await writeFinalReportWithExistingRuntime({ userId: context.execution.userId, conversationId: context.execution.conversationId, projectId: run.workspace.projectId, signal: context.signal, modelOverride, plan: planSnapshot!, architecture, claims: claimPackets, profile: run.workspace.budgetProfile, repair: { draft: reportBody, instructions: [...deterministicAudit.issues.map((issue) => issue.message), ...modelAudit.repairInstructions] }, methodology: methodology("writer") });
      recordResearchModelStage(state, repair, { modelCallReserved: true, estimateRole: "research.synthesizer" });
      if (repair.value) reportBody = repair.value;
      deterministicAudit = deterministicReportAudit({ report: reportBody, evidenceRefs: evidence.map((item) => item.id), claims: claimPackets });
      if (canUseFinalizationModel("research.report_auditor") && tryReserveResearchBudgetCounter(state, limits, "modelCalls")) {
        const reaudit = await auditFinalReportWithExistingRuntime({ userId: context.execution.userId, conversationId: context.execution.conversationId, projectId: run.workspace.projectId, signal: context.signal, modelOverride, plan: planSnapshot!, architecture, claims: claimPackets, report: reportBody, bibliographySourceIds: bibliographySourceIdsFor(reportBody), methodology: methodology("auditor") });
        recordResearchModelStage(state, reaudit, { modelCallReserved: true, estimateRole: "research.report_auditor" });
        if (reaudit.value) modelAudit = normalizeReportAuditDecision(reaudit.value);
      }
      reportAuditPass = deterministicAudit.pass && modelAudit.pass;
    }
    if (!reportAuditPass) degradationCodes.add("research_report_quality_gate_failed");
    state.draftReport = reportBody;
    await context.saveCheckpoint(checkpointWithResearch(checkpoint, state));

    const citedEvidenceIds = [...new Set(evidenceMarkersInReport(reportBody).flatMap((marker) => evidence[marker - 1]?.id ? [evidence[marker - 1].id] : []))];
    const citedEvidenceSet = new Set(citedEvidenceIds);
    const citationMap = Object.fromEntries(Object.entries(fullCitationMap).flatMap(([claimId, entries]) => {
      if (claimStatuses[claimId]?.status === "unsupported") return [];
      const filtered = entries.filter((entry) => citedEvidenceSet.has(entry.evidenceId));
      return filtered.length > 0 ? [[claimId, filtered]] : [];
    }));
    const citedSnapshots = [...new Set(evidence.filter((item) => citedEvidenceSet.has(item.id)).map((item) => item.sourceSnapshotId))];
    const verificationSummary = { citationExistence: citedEvidenceIds.length > 0 ? "verified" : "needs_qualification", citationSupport: unsupportedClaims.length === 0 ? "verified" : "unsupported", citationAdequacy: conflictedClaims.length > 0 ? "conflicted" : citedSnapshots.length > 0 ? "verified" : "unsupported", unsupportedClaims: unsupportedClaims.length, conflictedClaims: conflictedClaims.length, needsQualification: qualifiedClaims.length, verificationRepairs: state.verificationRepairs, verifierAvailable, verifierReasons: claimStatuses, reportAuditPass, auditIssues: [...deterministicAudit.issues, ...modelAudit.issues] };
    const reportClaims = claims.filter((claim) => claimStatuses[claim.id]?.status !== "unsupported");
    const reportStructure = buildResearchReportStructure(reportClaims.map((claim) => ({ id: claim.id, statement: claim.statement, questionId: claim.questionId, questionTitle: claim.question?.title ?? null, evidenceRelations: claim.evidenceRelations.filter((relation) => citedEvidenceSet.has(relation.evidenceId)).map((relation) => ({ evidenceId: relation.evidenceId, sourceSnapshotId: relation.evidence.sourceSnapshotId, relation: relation.relation })) })));
    const qualityState = reportAuditPass && verifierAvailable && architectureAvailable ? "normal" : "degraded";
    const reportDocument = { schemaVersion: "2", citationFormat: "evidence-marker-v1", title: `研究报告：${run.question}`, format: "markdown", body: reportBody, qualityState, architecture, claimRefs: reportClaims.map((claim) => claim.id), citationRefs: citedSnapshots, evidenceRefs: citedEvidenceIds, ...reportStructure };
    const contentHash = createHash("sha256").update(JSON.stringify({ reportDocument, citationMap, verificationSummary })).digest("hex");
    const graphMetrics = state.citationExpansion?.metrics ?? {};
    const visualMetrics = state.visualEvidence?.metrics ?? {};
    // 统一 metrics：所有阶段只补充自己的计数，不重写含义重叠的字段。
    const scholarlyFilterMetrics = {
      applied: [...scholarlyFilterAccumulator.applied],
      dropped: [...scholarlyFilterAccumulator.dropped],
      questions: scholarlyFilterAccumulator.questions,
      relaxedRetry: scholarlyFilterAccumulator.relaxedRetry,
    };
    const unifiedMetrics = {
      evidenceCount: evidence.length,
      // sourceCount 是「唯一来源」数（按 canonical ResearchSource 去重），
      // sourceSnapshotCount 才是快照数：同一论文的多个 chunk 只算一个来源，
      // 而同一来源在不同读取范围下可能有多个 snapshot。
      sourceCount: canonicalSourceCount,
      sourceSnapshotCount: sourceSnapshots.length,
      claimCount: claims.length,
      modelCalls: state.modelCalls,
      searchCalls: state.searchCalls,
      fetchCalls: state.fetchCalls,
      candidateSourceCount: state.sourceCount,
      promptTokens: state.promptTokens ?? 0,
      completionTokens: state.completionTokens ?? 0,
      totalTokens: state.totalTokens ?? 0,
      costCredits: state.costCredits ?? 0,
      elapsedMs: Date.now() - (run.startedAt ?? run.createdAt).getTime(),
      verificationRepairs: state.verificationRepairs,
      replanCount: state.replanCount,
      visualResourceCount: typeof visualMetrics.resourcesPersisted === "number" ? visualMetrics.resourcesPersisted : 0,
      visualObservationCount: typeof visualMetrics.observationsPersisted === "number" ? visualMetrics.observationsPersisted : 0,
      budgetStopReason: state.budgetStopReason ?? lastBudgetStopReason,
      degradationCount: degradationCodes.size,
      finalizationBudgetReserved: finalizationReserve,
      finalizationBudgetUsed: {
        modelCalls: state.modelCalls - finalizationStart.modelCalls,
        totalTokens: (state.totalTokens ?? 0) - finalizationStart.totalTokens,
        costCredits: (state.costCredits ?? 0) - finalizationStart.costCredits,
      },
      finalizationBudgetRemaining: finalizationBudgetRemaining({ limits, modelCalls: state.modelCalls, totalTokens: state.totalTokens ?? 0, costCredits: state.costCredits ?? 0 }),
      reportAuditPass,
      ...graphMetrics,
      verificationSummary,
    };
    const existingModelConfiguration = run.modelConfiguration && typeof run.modelConfiguration === "object" && !Array.isArray(run.modelConfiguration) ? run.modelConfiguration as Record<string, unknown> : {};
    const { researchSkills: _privateResearchSkills, ...publicModelConfiguration } = existingModelConfiguration;
    void _privateResearchSkills;
    const report = await prisma.researchReportSnapshot.create({ data: { workspaceId: run.workspaceId, runId: run.id, planVersionId: run.planVersionId, reportDocument: json(reportDocument), claimSnapshots: json(claims.map((claim) => ({ id: claim.id, statement: claim.statement, verificationStatus: claimStatuses[claim.id]?.status ?? "unsupported", reasonCode: claimStatuses[claim.id]?.reasonCode }))), evidenceIds: citedEvidenceIds, sourceSnapshotIds: citedSnapshots, citationMap: json(citationMap), coverageSummary: json({ questionCount: reportQuestions.length, evidenceCount: evidence.length, citedEvidenceCount: citedEvidenceIds.length, sourceCount: canonicalSourceCount, citedSourceSnapshotCount: citedSnapshots.length, graph: graphMetrics, visual: visualMetrics, scholarlyFilters: scholarlyFilterMetrics }), verificationSummary: json(verificationSummary), modelConfiguration: json({ ...publicModelConfiguration, promptVersions: RESEARCH_PROMPT_VERSIONS, researchSkills: publicResearchSkillSnapshot(existingModelConfiguration) }), contentHash } });
    await prisma.researchRun.update({ where: { id: run.id }, data: { status: "completed", completedAt: new Date(), metrics: json({ ...unifiedMetrics, scholarlyFilters: scholarlyFilterMetrics, degradations: [...degradationCodes] }) } });
    await appendPublicEvent(context, { key: "research:report:completed", kind: "report_completed", runId: run.id, message: reportAuditPass ? "研究报告已通过质量核验并冻结为不可修改快照" : "研究资料已冻结；最终综合或质量核验未完整通过", publicData: { reportId: report.id, evidenceCount: citedEvidenceIds.length, sourceCount: citedSnapshots.length, verificationSummary, qualityState } });
    return { kind: "completed", checkpoint };
  };
}
