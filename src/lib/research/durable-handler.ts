import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import type { AgentCheckpoint } from "@/lib/agent/executions/agent-execution-store";
import type { AgentModel, AgentUsage } from "@/lib/agent/contracts";
import type { AgentExecutionHandler, AgentExecutionHandlerContext, AgentExecutionHandlerResult } from "@/lib/agent/executions/agent-execution-runner";
import { DEEPSEEK_CHAT_MODEL } from "@/lib/chat/model-catalog";
import { evaluateResearchStop, getResearchBudget, releaseResearchBudgetCounter, tryReserveResearchBudgetCounter } from "./budget";
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
import { assertResearchRunTransition } from "./state-machine";
import type { ResearchPlanSnapshot, ResearchQuestionStatus, ResearchRunStatus } from "./contracts";
import { nextResearchTaskRetryStatus } from "./task-retry";
import { addResearchUsage, EMPTY_RESEARCH_USAGE } from "./accounting";
import { applyResearchPlannerDecision } from "./plan";
import { appendVerificationQualification, selectVerificationRepairTargets, verificationRepairInstruction, type VerificationRepairTarget } from "./verification-repair";
import { buildResearchReportStructure } from "./report-document";
import { buildResearchCitationMap } from "./report-citations";
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

function json(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}

function checkpointWithResearch(checkpoint: AgentCheckpoint, researchState: ResearchState): AgentCheckpoint {
  return { ...checkpoint, researchState };
}

function recordResearchModelStage(state: ResearchState, result: { attempted: boolean; usage: AgentUsage | null; model: AgentModel }, options?: { modelCallReserved?: boolean }) {
  if (result.attempted && !options?.modelCallReserved) state.modelCalls += 1;
  if (!result.usage) return;
  const usage = addResearchUsage({ promptTokens: state.promptTokens ?? 0, completionTokens: state.completionTokens ?? 0, totalTokens: state.totalTokens ?? 0, costCredits: state.costCredits ?? 0 }, result.usage, result.model);
  state.promptTokens = usage.promptTokens;
  state.completionTokens = usage.completionTokens;
  state.totalTokens = usage.totalTokens;
  state.costCredits = usage.costCredits;
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

export interface SynthesisClaimInput {
  id: string;
  statement: string;
  status: "verified" | "needs_qualification" | "unsupported" | "conflicted";
  reasonCode: string;
  qualifiers: string[];
  /** 该 Claim 实际建立 ClaimEvidenceRelation 的 Evidence 标记（如 E1、E3），按关系顺序。 */
  markers: string[];
  relations: Array<{ marker: string; relation: string }>;
}

export interface SynthesisEvidenceInput {
  id: string;
  statement: string;
  excerpt: string;
  source: string;
}

function formatEvidenceList(evidence: SynthesisEvidenceInput[]) {
  return evidence.map((item, index) => `E${index + 1}（${item.id}）. ${item.statement}\n来源：${item.source}\n摘录：${item.excerpt}`).join("\n\n").slice(0, 60_000);
}

async function synthesizeWithExistingRuntime(input: {
  userId: string;
  conversationId: string;
  projectId: string | null;
  signal: AbortSignal;
  question: string;
  domainProfile?: ResearchPlanSnapshot["domainProfile"];
  claims: SynthesisClaimInput[];
  evidence: SynthesisEvidenceInput[];
  useModel: boolean;
}) {
  const evidenceText = formatEvidenceList(input.evidence);
  const claimsText = input.claims.map((claim) => {
    const relationText = claim.relations.map((relation) => `${relation.marker}=${relation.relation}`).join("，") || "无";
    return [
      `- Claim（${claim.id}，核验状态=${claim.status}，reason=${claim.reasonCode}）：${claim.statement}`,
      `  允许引用的证据标记：${claim.markers.join("、") || "无"}（关系：${relationText}）`,
      claim.qualifiers.length > 0 ? `  限定条件：${claim.qualifiers.join("；")}` : null,
    ].filter(Boolean).join("\n");
  }).join("\n");
  const claimDriven = input.claims.length > 0;
  const prompt = claimDriven
    ? [
        "你是 LumenLab 的研究报告 Synthesizer。只使用下面已经持久化的 Claim Graph 与其关联 Evidence，不联网，不补写未提供的事实。",
        "输出一份简洁的 Markdown 研究报告：",
        "- 核验状态为 verified 的 Claim 可以作为正常结论；",
        "- needs_qualification 的 Claim 必须带限定措辞（范围、时间、条件或因果强度）后才能进入正文；",
        "- conflicted 的 Claim 必须明确呈现为证据冲突或不确定结论，不能单方面断言；",
        "- unsupported 的 Claim 不允许作为肯定性事实写入报告。",
        "每个事实性断言末尾添加证据标记（如 [E1]）：只能使用该 Claim「允许引用的证据标记」中列出的编号，不能从其他 Claim 或 Evidence 列表里补引用，不能编造编号。",
        `领域 Profile：${JSON.stringify(input.domainProfile ?? {})}`,
        `研究问题：${input.question}`,
        "\nClaim Graph：\n",
        claimsText,
        "\n已保存 Evidence（仅供核对标记与摘录，不代表可自由引用）：\n",
        evidenceText || "（没有可用 Evidence）",
      ].join("\n")
    : [
        "你是 LumenLab 的研究报告 Synthesizer。只使用下面已经读取并保存的 Evidence，不联网，不补写未提供的事实。",
        "输出一份简洁的 Markdown 研究报告，明确结论、证据不足、冲突与范围限制；不要展示隐藏推理。",
        "每个重要事实性断言末尾尽量添加对应的证据标记，例如 [E1] 或 [E2]；只能使用下面列出的 E 编号，不能编造编号，也不要把 Evidence ID 直接写入正文。",
        `领域 Profile：${JSON.stringify(input.domainProfile ?? {})}`,
        `研究问题：${input.question}`,
        "\n已保存 Evidence：\n",
        evidenceText || "（没有可用 Evidence）",
      ].join("\n");
  const stage = input.useModel ? await runResearchModelStage<string>({
    role: "research.synthesizer",
    userId: input.userId,
    conversationId: input.conversationId,
    projectId: input.projectId,
    signal: input.signal,
    prompt,
    parse: (content) => content.trim() || null,
  }) : { value: null, usage: null, model: DEEPSEEK_CHAT_MODEL, attempted: false };
  if (stage.value) return { content: stage.value, usage: stage.usage, model: stage.model, attempted: stage.attempted };
  if (claimDriven) {
    const lines: string[] = [];
    for (const claim of input.claims) {
      const markers = claim.markers.map((marker) => `[${marker}]`).join("");
      if (claim.status === "verified") lines.push(`- ${claim.statement}${markers}`);
      else if (claim.status === "needs_qualification") lines.push(`- （需限定）${claim.statement}${claim.qualifiers.length > 0 ? `——限定：${claim.qualifiers.join("；")}` : ""}${markers}`);
      else if (claim.status === "conflicted") lines.push(`- （证据冲突，结论不确定）${claim.statement}${markers}`);
    }
    return {
      content: lines.length > 0
        ? `## 研究结论\n\n本次研究围绕“${input.question}”形成以下可核验结论：\n\n${lines.join("\n")}\n\n## 限制\n\n以上内容只代表当前 Run 已成功读取的来源与核验状态，不替代未完成的独立验证。`
        : `## 研究结论\n\n当前 Run 的 Claim 均未达到可作为结论的核验状态，不能对“${input.question}”形成可靠结论。`,
      usage: null,
      model: stage.model,
      attempted: stage.attempted,
    };
  }
  return {
    content: evidenceText
      ? `## 研究结论\n\n本次研究围绕“${input.question}”收集了以下可核验证据：\n\n${input.evidence.map((item, index) => `- ${item.statement}（来源：${item.source}）[E${index + 1}]`).join("\n")}\n\n## 限制\n\n以上内容只代表当前 Run 已成功读取的来源，不替代未完成的独立验证。`
      : `## 研究结论\n\n当前 Run 没有成功读取可核验来源，不能对“${input.question}”形成可靠结论。`,
    usage: null,
    model: stage.model,
    attempted: stage.attempted,
  };
}

async function repairReportWithExistingRuntime(input: {
  userId: string;
  conversationId: string;
  projectId: string | null;
  signal: AbortSignal;
  question: string;
  domainProfile?: ResearchPlanSnapshot["domainProfile"];
  draft: string;
  evidence: Array<{ id: string; statement: string; excerpt: string; source: string }>;
  targets: VerificationRepairTarget[];
  unsupportedClaims: number;
  conflictedClaims: number;
  qualifiedClaims: number;
  useModel: boolean;
}) {
  const evidenceText = input.evidence.map((item, index) => `E${index + 1}（${item.id}）. ${item.statement}\n来源：${item.source}\n摘录：${item.excerpt}`).join("\n\n").slice(0, 60_000);
  const prompt = [
    "你是 LumenLab 的 Citation Repair Synthesizer。只使用当前 Run 已读取并保存的 Evidence，不联网，不展示隐藏推理。",
    "局部修订下面的 Markdown 报告：删除或改写没有直接支持的断言，明确表达冲突证据，并为范围、日期、因果等强措辞加限定。保留可验证的内容和原有结构。",
    "重要事实性断言末尾使用 [E1] 等标记；只能使用下面列出的 E 编号，不能编造编号或 Evidence ID。",
    `领域 Profile：${JSON.stringify(input.domainProfile ?? {})}`,
    `研究问题：${input.question}`,
    `核验缺口：${input.targets.map(verificationRepairInstruction).join("\n") || "当前报告存在需要限定的引用"}`,
    `当前报告草稿：\n${input.draft}`,
    `已保存 Evidence：\n${evidenceText || "（没有可用 Evidence）"}`,
  ].join("\n\n");
  const stage = input.useModel ? await runResearchModelStage<string>({
    role: "research.synthesizer",
    userId: input.userId,
    conversationId: input.conversationId,
    projectId: input.projectId,
    signal: input.signal,
    prompt,
    parse: (content) => content.trim() || null,
  }) : { value: null, usage: null, model: DEEPSEEK_CHAT_MODEL, attempted: false };
  return {
    content: stage.value ?? appendVerificationQualification({ draft: input.draft, unsupportedClaims: input.unsupportedClaims, conflictedClaims: input.conflictedClaims, qualifiedClaims: input.qualifiedClaims }),
    usage: stage.usage,
    model: stage.model,
    attempted: stage.attempted,
  };
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
    const run = await prisma.researchRun.findFirst({ where: { id: request.researchRunId, userId: context.execution.userId }, include: { workspace: true, activePlanVersion: true } });
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

    /** 最近一次评估得出的预算停止原因（进入 run.metrics.budgetStopReason）。 */
    let lastBudgetStopReason = "continue";
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
    const domainProfile = (run.activePlanVersion?.plan as unknown as ResearchPlanSnapshot | undefined)?.domainProfile;
    const planSnapshot = run.activePlanVersion?.plan as unknown as ResearchPlanSnapshot | undefined;
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
        prompt: [
          "你是 LumenLab Research Planner。只返回 JSON，不要 Markdown，不要隐藏推理，不要联网。",
          "你只能在已有计划上做有限、可解释的规划修订，不能虚构来源或直接生成研究结论。",
          "格式：{\"scope\":\"范围\",\"timeRange\":\"时间范围或 null\",\"sourceStrategy\":[\"来源策略\"],\"completionCriteria\":[\"完成标准\"],\"expectedOutputs\":[\"预期产出\"],\"questions\":[{\"key\":\"q1\",\"title\":\"标题\",\"question\":\"问题\",\"priority\":\"critical|important|supporting\",\"completionCriteria\":[\"标准\"],\"sourceStrategy\":[\"策略\"]}]}。",
          `用户研究问题：${run.question}`,
          `预算配置：${run.workspace.budgetProfile}`,
          `领域 Profile：${JSON.stringify(domainProfile ?? {})}`,
          `当前计划：${JSON.stringify(currentPlan)}`,
          "只保留最多八个研究问题；优先 critical，再 important，最后 supporting。",
        ].join("\n"),
      });
      recordResearchModelStage(state, plannerResult);
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
      const hardBudgetReached = elapsedMs >= limits.wallTimeMs || state.modelCalls >= limits.modelCalls || (state.totalTokens ?? 0) >= limits.maxTokens || (state.costCredits ?? 0) >= limits.maxCostCredits || state.searchCalls >= limits.searchCalls || state.fetchCalls >= limits.fetchCalls || state.sourceCount >= limits.maxSources;
      if (hardBudgetReached) {
        state.stage = "evaluating";
        await appendPublicEvent(context, { key: `research:budget:reached:${run.id}:${state.searchCalls}:${state.fetchCalls}`, kind: "budget_updated", runId: run.id, message: "已达到研究硬预算，进入评估阶段", publicData: { elapsedMs, modelCalls: state.modelCalls, promptTokens: state.promptTokens ?? 0, completionTokens: state.completionTokens ?? 0, totalTokens: state.totalTokens ?? 0, costCredits: state.costCredits ?? 0, searchCalls: state.searchCalls, fetchCalls: state.fetchCalls, sourceCount: state.sourceCount, limits } });
        await transitionRun(run.id, "evaluating");
        await context.saveCheckpoint(checkpointWithResearch(checkpoint, state));
        return { kind: "rescheduled", checkpoint: checkpointWithResearch(checkpoint, state) };
      }
      await prisma.researchTask.updateMany({
        where: { runId: run.id, status: "running" },
        data: { status: "retrying", lastError: json({ code: "worker_recovered_running_task" }) },
      });
      const tasks = await prisma.researchTask.findMany({ where: { runId: run.id, status: { in: ["pending", "retrying"] } }, include: { question: true }, orderBy: [{ priority: "asc" }, { createdAt: "asc" }], take: Math.min(limits.researcherConcurrency, Math.max(0, limits.modelCalls - state.modelCalls)) });
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
          if (!tryReserveResearchBudgetCounter(state, limits, "modelCalls")) {
            await prisma.researchTask.update({ where: { id: task.id }, data: { status: "retrying", lastError: json({ code: "research_model_budget_reserved" }) } });
            return;
          }
          const workerResult = await runResearchModelStage<ResearchWorkerDecision>({
            role: "research.worker",
            userId: context.execution.userId,
            conversationId: context.execution.conversationId,
            projectId: run.workspace.projectId,
            signal: context.signal,
            prompt: [
              "你是 LumenLab Research Worker 的 Query Generation 阶段。只返回 JSON，不要 Markdown，不要隐藏推理。",
              "JSON 格式：{\"queries\":[\"最多三个短而互补的检索词\"],\"rationale\":\"一句话\"}。",
              `全局研究问题：${run.question}`,
              `当前 Research Question：${task.question.question}`,
              `当前 Task 说明：${task.instructions ?? "沿用 Research Question，优先补充独立来源。"}`,
              `领域 Profile：${JSON.stringify(domainProfile ?? {})}`,
              `约束：${directiveContext || "优先学术、官方和项目资料；不要扩大研究范围。"}`,
            ].join("\n"),
          });
          recordResearchModelStage(state, workerResult, { modelCallReserved: true });
          const workerDecision = normalizeResearchWorkerDecision(workerResult.value, task.question.question);
          await appendPublicEvent(context, { key: `research:query:${task.id}:${attempt}`, kind: "task_started", runId: run.id, message: `已生成检索策略：${task.question.title}`, publicData: { questionId: task.question.id, queries: workerDecision.queries } });
          for (const query of workerDecision.queries) {
            if (context.signal.aborted || !tryReserveResearchBudgetCounter(state, limits, "searchCalls")) break;
            const taskContext: ResearchProviderContext = { ...providerContext, question: task.question.question };
            const candidates = await provider.search(taskContext, query);
            for (const candidate of prioritizeResearchCandidates(candidates, domainProfile?.preferredProviders)) {
              if (context.signal.aborted || state.sourceCount >= limits.maxSources) break;
              const savedCandidate = await persistCandidate({ workspaceId: run.workspaceId, runId: run.id, questionId: task.question.id, candidate });
              // 同一 Run 内已被成功读取的候选不重复 fetch：Evidence 由
              // (runId, evidenceKey) 幂等，再读只会烧 fetch budget 而不产生新证据。
              if (savedCandidate.status === "fetched") continue;
              await appendPublicEvent(context, { key: `research:candidate:${savedCandidate.id}`, kind: "source_candidate_discovered", runId: run.id, message: `发现来源候选：${candidate.title}`, publicData: { candidateId: savedCandidate.id, provider: candidate.provider, url: candidate.url, query } });
              if (!tryReserveResearchBudgetCounter(state, limits, "sourceCount")) break;
              if (!tryReserveResearchBudgetCounter(state, limits, "fetchCalls")) {
                releaseResearchBudgetCounter(state, "sourceCount");
                continue;
              }
              let saved: Awaited<ReturnType<typeof ingestResearchReadSource>> = null;
              let readTitle = candidate.title;
              try {
                const read = await provider.read(taskContext, candidate);
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
      const questions = await prisma.researchQuestion.findMany({ where: { runId: run.id }, include: { evidence: { where: { status: "active" }, select: { id: true, statement: true, sourceSnapshot: { select: { retrievedAt: true, source: { select: { id: true, kind: true, metadata: true } } } } } } }, orderBy: { orderIndex: "asc" } });
      let unresolvedCritical: typeof questions[number] | undefined;
      const evaluatedStatuses = new Map<string, ResearchQuestionStatus>();
      for (const question of questions) {
        const fallbackDecision: ResearchEvaluatorDecision = {
          status: question.evidence.length >= 2 ? "resolved" : question.evidence.length === 1 ? "partially_resolved" : "unresolved",
          coverage: question.evidence.length > 0 ? Math.min(1, question.evidence.length / 2) : 0,
          directness: question.evidence.length > 0 ? 0.7 : 0,
        };
        let decision = fallbackDecision;
        const canEvaluateQuestion = question.evaluateAttempts < limits.maxQuestionEvaluateAttempts;
        if (canEvaluateQuestion && state.modelCalls < limits.modelCalls && (state.totalTokens ?? 0) < limits.maxTokens && (state.costCredits ?? 0) < limits.maxCostCredits) {
          const evaluatorResult = await runResearchModelStage<ResearchEvaluatorDecision>({
            role: "research.evaluator",
            userId: context.execution.userId,
            conversationId: context.execution.conversationId,
            projectId: run.workspace.projectId,
            signal: context.signal,
            prompt: [
              "你是 LumenLab Research Evaluator。只返回 JSON，不要 Markdown，不要隐藏推理。",
              "格式：{\"status\":\"resolved|partially_resolved|unresolved|controversial\",\"coverage\":0到1,\"directness\":0到1,\"gap\":\"缺口\",\"followUpQueries\":[\"可选检索词\"]}。",
              `研究问题：${question.question}`,
              `完成标准：${JSON.stringify(question.completionCriteria)}`,
              `领域 Profile：${JSON.stringify(domainProfile ?? {})}`,
              `已有 Evidence：${JSON.stringify(question.evidence.map((item) => ({ statement: item.statement, sourceKind: item.sourceSnapshot.source.kind })))}`,
              "只根据这些 Evidence 判断；没有证据不能判定 resolved。",
            ].join("\n"),
          });
          recordResearchModelStage(state, evaluatorResult);
          decision = normalizeResearchEvaluatorDecision(evaluatorResult.value, fallbackDecision);
        }
        const status = question.evidence.length === 0
          ? "unresolved"
          : question.evidence.length === 1 && decision.status === "resolved"
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
        await prisma.researchQuestion.update({ where: { id: question.id }, data: { status, evaluateAttempts: canEvaluateQuestion ? { increment: 1 } : undefined, qualitySummary: json({ coverage: decision.coverage, directness: decision.directness, gap: decision.gap, followUpQueries: decision.followUpQueries ?? [], conflictReviewed: true, dimensions: quality, evaluationBudgetExhausted: !canEvaluateQuestion }) } });
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
      const stopDecision = evaluateResearchStop({ limits, modelCalls: state.modelCalls, totalTokens: state.totalTokens, costCredits: state.costCredits, searchCalls: state.searchCalls, fetchCalls: state.fetchCalls, sourceCount: state.sourceCount, elapsedMs: Date.now() - (run.startedAt ?? run.createdAt).getTime(), criticalQuestionsResolved: !unresolvedCritical, semanticCoverage, sourceDiversity, independentCorroboration, conflictCoverage, informationGain, hasPendingCriticalWork: Boolean(unresolvedCritical) });
      lastBudgetStopReason = stopDecision.reason;
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
          if (!tryReserveResearchBudgetCounter(state, limits, "searchCalls")) break;
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
          tryReserve: (counter) => tryReserveResearchBudgetCounter(state, limits, counter),
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
      const policy = getResearchVisualPolicy(run.workspace.budgetProfile);
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

        if (!tryReserveResearchBudgetCounter(state, limits, "modelCalls")) {
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
          prompt: buildVisualEvidencePrompt({ question: item.questionText, resources: promptResources, bodyContext: item.bodyContext }),
          attachments: resources.map((resource) => ({
            name: resource.fileName.split("/").pop() || "figure",
            mimeType: resource.mimeType,
            size: resource.bytes.length,
            data: resource.bytes,
          })),
        });
        metrics.modelCalls += 1;
        recordResearchModelStage(state, stage, { modelCallReserved: true });
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
        if (!tryReserveResearchBudgetCounter(state, limits, "modelCalls")) {
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
          prompt: buildClaimExtractionPrompt({
            question: { key: question.key, title: question.title, question: question.question, completionCriteria: question.completionCriteria },
            domainProfile,
            evidence: question.evidence.map((evidence) => ({
              id: evidence.id,
              statement: evidence.statement,
              excerpt: evidence.excerpt,
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
          }),
        });
        recordResearchModelStage(state, extractorResult, { modelCallReserved: true });
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
      state.stage = "synthesizing";
      await transitionRun(run.id, "synthesizing");
      await context.saveCheckpoint(checkpointWithResearch(checkpoint, state));
      await appendPublicEvent(context, { key: "research:stage:claim_extraction", kind: "stage_changed", runId: run.id, message: "Claim Extraction 完成，进入报告整理", publicData: { extractedQuestions, questionCount: questions.length } });
      return { kind: "rescheduled", checkpoint: checkpointWithResearch(checkpoint, state) };
    }

    if (state.stage === "synthesizing") {
      const evidence = await prisma.evidence.findMany({ where: { runId: run.id, status: "active" }, include: { sourceSnapshot: { include: { source: true } } }, orderBy: { createdAt: "asc" } });
      const synthesisClaims = await prisma.claim.findMany({
        where: { runId: run.id, status: { in: ["active", "disputed"] } },
        include: { evidenceRelations: { include: { evidence: { select: { id: true, status: true, evidenceType: true, sourceSnapshot: { select: { sourceId: true, metadata: true } } } } } } },
        orderBy: { createdAt: "asc" },
      });
      const markerByEvidenceId = new Map(evidence.map((item, index) => [item.id, `E${index + 1}`]));
      const claimsInput: SynthesisClaimInput[] = synthesisClaims.map((claim) => {
        const precheck = computeDeterministicClaimVerification(claim.evidenceRelations.map((relation) => ({
          relation: relation.relation,
          evidence: {
            status: relation.evidence.status,
            evidenceType: relation.evidence.evidenceType,
            snapshotScopeType: snapshotScopeTypeOf(relation.evidence.sourceSnapshot.metadata),
            sourceSnapshot: { sourceId: relation.evidence.sourceSnapshot.sourceId },
          },
        })));
        const qualifiers = claim.quality && typeof claim.quality === "object" && !Array.isArray(claim.quality) && Array.isArray((claim.quality as Record<string, unknown>).qualifiers)
          ? ((claim.quality as Record<string, unknown>).qualifiers as unknown[]).filter((item): item is string => typeof item === "string")
          : [];
        const relations = claim.evidenceRelations.flatMap((relation) => {
          const marker = markerByEvidenceId.get(relation.evidenceId);
          return marker ? [{ marker, relation: relation.relation }] : [];
        });
        return { id: claim.id, statement: claim.statement, status: precheck.status, reasonCode: precheck.reasonCode, qualifiers, markers: relations.map((relation) => relation.marker), relations };
      });
      const synthesis = await synthesizeWithExistingRuntime({ userId: context.execution.userId, conversationId: context.execution.conversationId, projectId: run.workspace.projectId, signal: context.signal, question: run.question, domainProfile, claims: claimsInput, useModel: state.modelCalls < limits.modelCalls && (state.totalTokens ?? 0) < limits.maxTokens && (state.costCredits ?? 0) < limits.maxCostCredits, evidence: evidence.map((item) => ({ id: item.id, statement: item.statement, excerpt: item.excerpt, source: item.sourceSnapshot.source.title ?? item.sourceSnapshot.source.canonicalKey })) });
      state.draftReport = synthesis.content;
      recordResearchModelStage(state, synthesis);
      state.stage = "verifying";
      await transitionRun(run.id, "verifying");
      await context.saveCheckpoint(checkpointWithResearch(checkpoint, state));
      await appendPublicEvent(context, { key: "research:synthesis:completed", kind: "stage_changed", runId: run.id, message: "已生成结构化报告草稿，开始核验引用", publicData: { evidenceCount: evidence.length } });
      return { kind: "rescheduled", checkpoint: checkpointWithResearch(checkpoint, state) };
    }

    const existingReport = await prisma.researchReportSnapshot.findUnique({ where: { runId: run.id } });
    if (existingReport) return { kind: "completed", checkpoint };
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
    if (state.modelCalls < limits.modelCalls && (state.totalTokens ?? 0) < limits.maxTokens && (state.costCredits ?? 0) < limits.maxCostCredits) {
      const verifierResult = await runResearchModelStage<ResearchVerifierDecision>({
        role: "research.verifier",
        userId: context.execution.userId,
        conversationId: context.execution.conversationId,
        projectId: run.workspace.projectId,
        signal: context.signal,
        prompt: [
          "你是 LumenLab Citation Verifier。只返回 JSON，不要 Markdown，不要隐藏推理，也不要联网。",
          "格式：{\"claims\":{\"claimId\":{\"status\":\"verified|needs_qualification|unsupported|conflicted\",\"reasonCode\":\"sufficient_support|single_source_only|indirect_support|scope_mismatch|temporal_mismatch|mixed_evidence|contradicted|no_support|invalid_evidence|model_review\"}}}。",
          "每个 Claim 只给出它实际关联的 Evidence；不要引用其他 Claim 的证据，不要把只有 context 关系的证据当作支持。",
          "逐条检查：Evidence 是否直接支持 Claim（directness）、独立来源是否充足（同一 ResearchSource 的多个 chunk 只算一个来源）、是否存在反驳或混合证据、范围/日期/因果是否超出 Evidence 表达、Claim 措辞是否需要限定。",
          "citationLinkedSourceCount 表示该 Claim 的支持来源之间存在直接引用关系的成对数量：它是来源独立性的风险信号，但有引用关系不自动等于不独立，仍按 Evidence 内容判断。",
          "evidenceType=visual_observation 表示这是模型从论文图表读出的派生观察，不等于原论文的直接陈述；只读到摘要级元数据（没有正文）的来源也不能作为正文事实引用。这两类证据已经由 deterministic 下界限制为最多 needs_qualification，你只能维持或继续下调。",
          "你只能确认或下调 deterministic 预检状态，不能把缺少直接支持或存在冲突的 Claim 升级为 verified。",
          `领域 Profile：${JSON.stringify(domainProfile ?? {})}`,
          `Claims 与关联 Evidence：${JSON.stringify(claims.map((claim) => ({
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
              excerpt: relation.evidence.excerpt,
              source: {
                canonicalKey: relation.evidence.sourceSnapshot.source.canonicalKey,
                title: relation.evidence.sourceSnapshot.source.title,
                kind: relation.evidence.sourceSnapshot.source.kind,
                doi: relation.evidence.sourceSnapshot.source.doi,
                canonicalUrl: relation.evidence.sourceSnapshot.source.canonicalUrl,
              },
            })),
          })))}`,
        ].join("\n"),
      });
      recordResearchModelStage(state, verifierResult);
      verifierDecision = normalizeResearchVerifierDecision(verifierResult.value);
      await context.saveCheckpoint(checkpointWithResearch(checkpoint, state));
    }
    const claimStatuses = Object.fromEntries(claims.map((claim) => {
      const deterministic = deterministicByClaim.get(claim.id)!;
      return [claim.id, mergeClaimVerification({ deterministic, model: verifierDecision.claims[claim.id] })];
    }));
    const unsupportedClaims = claims.filter((claim) => claimStatuses[claim.id]?.status === "unsupported");
    const conflictedClaims = claims.filter((claim) => claimStatuses[claim.id]?.status === "conflicted");
    const qualifiedClaims = claims.filter((claim) => claimStatuses[claim.id]?.status === "needs_qualification");
    const citationMap = buildResearchCitationMap(claims);
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
      && state.searchCalls < limits.searchCalls
      && state.fetchCalls < limits.fetchCalls
      && state.sourceCount < limits.maxSources;
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
    const hasVerificationIssues = unsupportedClaims.length > 0 || conflictedClaims.length > 0 || qualifiedClaims.length > 0;
    if (hasVerificationIssues) {
      const shouldUseRepairModel = state.verificationRepairs < limits.maxVerificationRepairs
        && state.modelCalls < limits.modelCalls
        && (state.totalTokens ?? 0) < limits.maxTokens
        && (state.costCredits ?? 0) < limits.maxCostCredits;
      if (shouldUseRepairModel) state.verificationRepairs += 1;
      const repair = await repairReportWithExistingRuntime({
        userId: context.execution.userId,
        conversationId: context.execution.conversationId,
        projectId: run.workspace.projectId,
        signal: context.signal,
        question: run.question,
        domainProfile,
        draft: state.draftReport ?? "",
        evidence: evidence.map((item) => ({ id: item.id, statement: item.statement, excerpt: item.excerpt, source: item.sourceSnapshot.source.title ?? item.sourceSnapshot.source.canonicalKey })),
        targets: repairTargets,
        unsupportedClaims: unsupportedClaims.length,
        conflictedClaims: conflictedClaims.length,
        qualifiedClaims: qualifiedClaims.length,
        useModel: shouldUseRepairModel,
      });
      state.draftReport = repair.content;
      recordResearchModelStage(state, repair);
      await context.saveCheckpoint(checkpointWithResearch(checkpoint, state));
      await appendPublicEvent(context, { key: `research:verification:qualified:${run.id}:${state.verificationRepairs}`, kind: "verification_updated", runId: run.id, message: "引用核验已完成局部修订并保留证据边界", publicData: { verificationRepairs: state.verificationRepairs, modelAttempted: repair.attempted, unsupportedClaims: unsupportedClaims.length, conflictedClaims: conflictedClaims.length, needsQualification: qualifiedClaims.length } });
    }
    const verificationSummary = { citationExistence: claims.length > 0 && unsupportedClaims.length === 0 ? "verified" : "needs_qualification", citationSupport: unsupportedClaims.length === 0 ? "verified" : "unsupported", citationAdequacy: conflictedClaims.length > 0 ? "conflicted" : sourceSnapshots.length > 0 ? "verified" : "unsupported", unsupportedClaims: unsupportedClaims.length, conflictedClaims: conflictedClaims.length, needsQualification: qualifiedClaims.length, verificationRepairs: state.verificationRepairs, verifierReasons: claimStatuses };
    const reportStructure = buildResearchReportStructure(claims.map((claim) => ({ id: claim.id, statement: claim.statement, questionId: claim.questionId, questionTitle: claim.question?.title ?? null, evidenceRelations: claim.evidenceRelations.map((relation) => ({ evidenceId: relation.evidenceId, sourceSnapshotId: relation.evidence.sourceSnapshotId, relation: relation.relation })) })));
    const reportDocument = { schemaVersion: "1", citationFormat: "evidence-marker-v1", title: `研究报告：${run.question}`, format: "markdown", body: state.draftReport ?? "", claimRefs: claims.map((claim) => claim.id), citationRefs: sourceSnapshots, evidenceRefs: evidence.map((item) => item.id), ...reportStructure };
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
      budgetStopReason: lastBudgetStopReason,
      degradationCount: degradationCodes.size,
      ...graphMetrics,
      verificationSummary,
    };
    const report = await prisma.researchReportSnapshot.create({ data: { workspaceId: run.workspaceId, runId: run.id, planVersionId: run.planVersionId, reportDocument: json(reportDocument), claimSnapshots: json(claims.map((claim) => ({ id: claim.id, statement: claim.statement, verificationStatus: claimStatuses[claim.id]?.status ?? "unsupported", reasonCode: claimStatuses[claim.id]?.reasonCode }))), evidenceIds: evidence.map((item) => item.id), sourceSnapshotIds: sourceSnapshots, citationMap: json(citationMap), coverageSummary: json({ questionCount: claims.length, evidenceCount: evidence.length, sourceCount: canonicalSourceCount, sourceSnapshotCount: sourceSnapshots.length, graph: graphMetrics, visual: visualMetrics, scholarlyFilters: scholarlyFilterMetrics }), verificationSummary: json(verificationSummary), modelConfiguration: json(run.modelConfiguration ?? {}), contentHash } });
    await prisma.researchRun.update({ where: { id: run.id }, data: { status: "completed", completedAt: new Date(), metrics: json({ ...unifiedMetrics, scholarlyFilters: scholarlyFilterMetrics, degradations: [...degradationCodes] }) } });
    await appendPublicEvent(context, { key: "research:report:completed", kind: "report_completed", runId: run.id, message: "研究报告已完成并冻结为不可修改快照", publicData: { reportId: report.id, evidenceCount: evidence.length, sourceCount: sourceSnapshots.length, verificationSummary } });
    return { kind: "completed", checkpoint };
  };
}
