import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { uploadObjectBuffer } from "@/lib/storage/object-storage";
import type { AgentCheckpoint } from "@/lib/agent/executions/agent-execution-store";
import type { AgentModel, AgentUsage } from "@/lib/agent/contracts";
import type { AgentExecutionHandler, AgentExecutionHandlerContext, AgentExecutionHandlerResult } from "@/lib/agent/executions/agent-execution-runner";
import { evaluateResearchStop, getResearchBudget, releaseResearchBudgetCounter, tryReserveResearchBudgetCounter } from "./budget";
import { buildSourceIdentity } from "./source-identity";
import { createToolBackedResearchSourceProvider, type ResearchCandidate, type ResearchProviderContext } from "./source-provider";
import { computeSourceDiversity } from "./quality";
import { assertResearchRunTransition } from "./state-machine";
import type { ResearchPlanSnapshot, ResearchRunStatus } from "./contracts";
import { nextResearchTaskRetryStatus } from "./task-retry";
import { addResearchUsage, EMPTY_RESEARCH_USAGE } from "./accounting";
import { applyResearchPlannerDecision } from "./plan";
import { appendVerificationQualification, selectVerificationRepairTargets, verificationRepairInstruction, type VerificationRepairTarget } from "./verification-repair";
import { buildResearchReportStructure } from "./report-document";
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

function sourceKind(candidate: ResearchCandidate) {
  return candidate.kind === "project_file" ? "project_file" : candidate.kind;
}

function prioritizeResearchCandidates(candidates: ResearchCandidate[], preferredProviders: string[] | undefined) {
  if (!preferredProviders?.length) return candidates;
  const rank = new Map(preferredProviders.map((provider, index) => [provider, index]));
  return [...candidates].sort((left, right) => (rank.get(left.provider) ?? preferredProviders.length) - (rank.get(right.provider) ?? preferredProviders.length));
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

async function persistReadSource(input: {
  userId: string;
  workspaceId: string;
  runId: string;
  questionId: string;
  read: Awaited<ReturnType<ReturnType<typeof createToolBackedResearchSourceProvider>["read"]>>;
}) {
  if (!input.read) return null;
  const metadata = input.read.candidate.metadata && typeof input.read.candidate.metadata === "object" ? input.read.candidate.metadata as Record<string, unknown> : {};
  const metadataDoi = typeof metadata.doi === "string" ? metadata.doi : null;
  const metadataPmid = typeof metadata.pmid === "string" ? metadata.pmid : null;
  const identity = buildSourceIdentity({
    kind: sourceKind(input.read.candidate),
    url: input.read.candidate.url,
    doi: input.read.candidate.kind === "doi" ? input.read.candidate.externalId : metadataDoi,
    arxivId: input.read.candidate.kind === "arxiv" ? input.read.candidate.externalId : null,
    pmid: input.read.candidate.kind === "pmid" ? input.read.candidate.externalId : metadataPmid,
    fileId: input.read.candidate.kind === "project_file" ? input.read.candidate.externalId : null,
  });
  const contentHash = createHash("sha256").update(input.read.content).digest("hex");
  let rawContentLocation: { provider: string; key: string };
  try {
    rawContentLocation = await uploadObjectBuffer({
      key: `research/${input.userId}/${input.runId}/${contentHash}.md`,
      mimeType: "text/markdown; charset=utf-8",
      buffer: Buffer.from(input.read.content, "utf8"),
    });
  } catch {
    return null;
  }

  const source = await prisma.researchSource.upsert({
    where: { workspaceId_canonicalKey: { workspaceId: input.workspaceId, canonicalKey: identity.canonicalKey } },
    create: {
      workspaceId: input.workspaceId,
      userId: input.userId,
      kind: sourceKind(input.read.candidate),
      canonicalKey: identity.canonicalKey,
      title: input.read.title,
      doi: identity.doi,
      arxivId: identity.arxivId,
      pmid: identity.pmid,
      canonicalUrl: identity.canonicalUrl,
      aliases: json({ urls: input.read.candidate.url ? [input.read.candidate.url] : [] }),
      metadata: json(input.read.metadata),
    },
    update: {
      title: input.read.title,
      metadata: json(input.read.metadata),
    },
  });
  const existingSnapshot = await prisma.researchSourceSnapshot.findFirst({ where: { runId: input.runId, sourceId: source.id, contentHash } });
  const snapshot = existingSnapshot ?? await prisma.researchSourceSnapshot.create({
    data: {
      workspaceId: input.workspaceId,
      runId: input.runId,
      sourceId: source.id,
      contentHash,
      sourceVersion: input.read.sourceVersion,
      rawContentLocation: json(rawContentLocation),
      excerpt: input.read.excerpt,
      metadata: json({ provider: input.read.candidate.provider, title: input.read.title }),
    },
  });
  const existingEvidence = await prisma.evidence.findFirst({ where: { runId: input.runId, sourceSnapshotId: snapshot.id, statement: input.read.excerpt, status: "active" } });
  const evidence = existingEvidence ?? await prisma.evidence.create({
    data: {
      workspaceId: input.workspaceId,
      runId: input.runId,
      questionId: input.questionId,
      sourceSnapshotId: snapshot.id,
      statement: input.read.excerpt,
      locator: json(input.read.locator),
      excerpt: input.read.excerpt,
      evidenceType: input.read.candidate.kind === "project_file" ? "project_context" : "paraphrase",
      provenance: json({ provider: input.read.candidate.provider, extraction: "bounded-source-reader-v1" }),
    },
  });
  return { source, snapshot, evidence };
}

async function synthesizeWithExistingRuntime(input: {
  userId: string;
  conversationId: string;
  projectId: string | null;
  signal: AbortSignal;
  question: string;
  domainProfile?: ResearchPlanSnapshot["domainProfile"];
  evidence: Array<{ id: string; statement: string; excerpt: string; source: string }>;
  useModel: boolean;
}) {
  const evidenceText = input.evidence.map((item, index) => `E${index + 1}（${item.id}）. ${item.statement}\n来源：${item.source}\n摘录：${item.excerpt}`).join("\n\n").slice(0, 60_000);
  const prompt = [
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
  }) : { value: null, usage: null, model: "deepseek-v4-pro" as const, attempted: false };
  if (stage.value) return { content: stage.value, usage: stage.usage, model: stage.model, attempted: stage.attempted };
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
  }) : { value: null, usage: null, model: "deepseek-v4-pro" as const, attempted: false };
  return {
    content: stage.value ?? appendVerificationQualification({ draft: input.draft, unsupportedClaims: input.unsupportedClaims, conflictedClaims: input.conflictedClaims, qualifiedClaims: input.qualifiedClaims }),
    usage: stage.usage,
    model: stage.model,
    attempted: stage.attempted,
  };
}

export function createDurableResearchExecutionHandler(): AgentExecutionHandler {
  const provider = createToolBackedResearchSourceProvider();
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
    const providerContext: ResearchProviderContext = {
      userId: context.execution.userId,
      conversationId: context.execution.conversationId,
      executionId: context.execution.id,
      runId: run.id,
      projectId: run.workspace.projectId,
      signal: context.signal,
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
            const candidates = await provider.search(providerContext, query);
            for (const candidate of prioritizeResearchCandidates(candidates, domainProfile?.preferredProviders)) {
              if (context.signal.aborted || state.sourceCount >= limits.maxSources) break;
              const savedCandidate = await persistCandidate({ workspaceId: run.workspaceId, runId: run.id, questionId: task.question.id, candidate });
              await appendPublicEvent(context, { key: `research:candidate:${savedCandidate.id}`, kind: "source_candidate_discovered", runId: run.id, message: `发现来源候选：${candidate.title}`, publicData: { candidateId: savedCandidate.id, provider: candidate.provider, url: candidate.url, query } });
              if (!tryReserveResearchBudgetCounter(state, limits, "sourceCount")) break;
              if (!tryReserveResearchBudgetCounter(state, limits, "fetchCalls")) {
                releaseResearchBudgetCounter(state, "sourceCount");
                continue;
              }
              let read: Awaited<ReturnType<ReturnType<typeof createToolBackedResearchSourceProvider>["read"]>> | null = null;
              let saved: Awaited<ReturnType<typeof persistReadSource>> = null;
              try {
                read = await provider.read(providerContext, candidate);
                if (!read) {
                  releaseResearchBudgetCounter(state, "sourceCount");
                  continue;
                }
                saved = await persistReadSource({ userId: context.execution.userId, workspaceId: run.workspaceId, runId: run.id, questionId: task.question.id, read });
                if (!saved) {
                  releaseResearchBudgetCounter(state, "sourceCount");
                  continue;
                }
              } catch (error) {
                releaseResearchBudgetCounter(state, "sourceCount");
                throw error;
              }
              if (!read || !saved) continue;
              await prisma.researchSourceCandidate.update({ where: { id: savedCandidate.id }, data: { status: "fetched" } });
              await appendPublicEvent(context, { key: `research:snapshot:${saved.snapshot.id}`, kind: "source_snapshot_created", runId: run.id, message: `已读取并保存来源：${read.title}`, publicData: { sourceId: saved.source.id, snapshotId: saved.snapshot.id, evidenceId: saved.evidence.id, evidenceCount: state.sourceCount, query } });
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
      const questions = await prisma.researchQuestion.findMany({ where: { runId: run.id }, include: { evidence: { where: { status: "active" }, select: { id: true, statement: true, sourceSnapshot: { select: { source: { select: { kind: true } } } } } } }, orderBy: { orderIndex: "asc" } });
      let unresolvedCritical: typeof questions[number] | undefined;
      for (const question of questions) {
        const fallbackDecision: ResearchEvaluatorDecision = {
          status: question.evidence.length >= 2 ? "resolved" : question.evidence.length === 1 ? "partially_resolved" : "unresolved",
          coverage: question.evidence.length > 0 ? Math.min(1, question.evidence.length / 2) : 0,
          directness: question.evidence.length > 0 ? 0.7 : 0,
        };
        let decision = fallbackDecision;
        if (state.modelCalls < limits.modelCalls && (state.totalTokens ?? 0) < limits.maxTokens && (state.costCredits ?? 0) < limits.maxCostCredits) {
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
        await prisma.researchQuestion.update({ where: { id: question.id }, data: { status, evaluateAttempts: { increment: 1 }, qualitySummary: json({ coverage: decision.coverage, directness: decision.directness, gap: decision.gap, followUpQueries: decision.followUpQueries ?? [] }) } });
        if (question.evidence.length > 0) {
          const claim = await prisma.claim.findFirst({ where: { runId: run.id, questionId: question.id, status: "active" } });
          const activeClaim = claim ?? await prisma.claim.create({ data: { workspaceId: run.workspaceId, runId: run.id, questionId: question.id, statement: question.evidence.length === 1 ? question.evidence[0].statement : `关于“${question.title}”的证据已获得独立来源支持。`, quality: json({ evidenceCount: question.evidence.length, label: status === "resolved" ? "证据充分" : status === "controversial" ? "存在争议" : "中等" }) } });
          await prisma.claimEvidenceRelation.createMany({ data: question.evidence.map((evidence) => ({ claimId: activeClaim.id, evidenceId: evidence.id, relation: "supports" as const, confidence: question.evidence.length >= 2 ? 0.8 : 0.55 })), skipDuplicates: true });
        }
        if (question.priority === "critical" && (status === "unresolved" || status === "controversial")) unresolvedCritical = question;
        await appendPublicEvent(context, { key: `research:question:evaluated:${question.id}:${state.replanCount}`, kind: "question_evaluated", runId: run.id, message: `${question.title}：${status === "resolved" ? "已解决" : status === "partially_resolved" ? "部分解决" : "未解决"}`, publicData: { questionId: question.id, status, evidenceCount: question.evidence.length } });
      }
      const allEvidence = questions.flatMap((question) => question.evidence);
      const semanticCoverage = questions.length === 0 ? 0 : questions.filter((question) => question.status === "resolved").length / questions.length;
      const sourceDiversity = computeSourceDiversity(allEvidence.map((evidence) => evidence.sourceSnapshot.source.kind));
      const independentCorroboration = questions.length === 0 ? 0 : questions.filter((question) => question.evidence.length >= 2).length / questions.length;
      const conflictCoverage = allEvidence.length === 0 ? 0 : independentCorroboration >= 0.5 ? 0.8 : 0.4;
      const stopDecision = evaluateResearchStop({ limits, modelCalls: state.modelCalls, totalTokens: state.totalTokens, costCredits: state.costCredits, searchCalls: state.searchCalls, fetchCalls: state.fetchCalls, sourceCount: state.sourceCount, elapsedMs: Date.now() - (run.startedAt ?? run.createdAt).getTime(), criticalQuestionsResolved: !unresolvedCritical, semanticCoverage, sourceDiversity, independentCorroboration, conflictCoverage, informationGain: allEvidence.length > 0 ? 1 : 0, hasPendingCriticalWork: Boolean(unresolvedCritical) });
      await appendPublicEvent(context, { key: `research:budget:evaluated:${run.id}:${state.replanCount}`, kind: "budget_updated", runId: run.id, message: stopDecision.summary, publicData: { ...stopDecision, semanticCoverage, sourceDiversity, independentCorroboration, conflictCoverage, counters: { modelCalls: state.modelCalls, promptTokens: state.promptTokens ?? 0, completionTokens: state.completionTokens ?? 0, totalTokens: state.totalTokens ?? 0, costCredits: state.costCredits ?? 0, searchCalls: state.searchCalls, fetchCalls: state.fetchCalls, sourceCount: state.sourceCount } } });
      if (!stopDecision.stop && unresolvedCritical && state.replanCount < limits.maxReplans && state.searchCalls < limits.searchCalls) {
        state.replanCount += 1;
        await prisma.researchQuestion.update({ where: { id: unresolvedCritical.id }, data: { replanAttempts: { increment: 1 } } });
        await prisma.researchTask.create({ data: { runId: run.id, questionId: unresolvedCritical.id, kind: "replanner", priority: "critical", title: `补充研究：${unresolvedCritical.title}`, instructions: `针对未解决问题补充独立来源：${unresolvedCritical.question}`, idempotencyKey: `${run.id}:${unresolvedCritical.key}:replan:${state.replanCount}` } });
        state.stage = "researching";
        await transitionRun(run.id, "researching");
      } else {
        state.stage = "synthesizing";
        await transitionRun(run.id, "synthesizing");
      }
      await context.saveCheckpoint(checkpointWithResearch(checkpoint, state));
      return { kind: "rescheduled", checkpoint: checkpointWithResearch(checkpoint, state) };
    }

    if (state.stage === "synthesizing") {
      const evidence = await prisma.evidence.findMany({ where: { runId: run.id, status: "active" }, include: { sourceSnapshot: { include: { source: true } } }, orderBy: { createdAt: "asc" } });
      const synthesis = await synthesizeWithExistingRuntime({ userId: context.execution.userId, conversationId: context.execution.conversationId, projectId: run.workspace.projectId, signal: context.signal, question: run.question, domainProfile, useModel: state.modelCalls < limits.modelCalls && (state.totalTokens ?? 0) < limits.maxTokens && (state.costCredits ?? 0) < limits.maxCostCredits, evidence: evidence.map((item) => ({ id: item.id, statement: item.statement, excerpt: item.excerpt, source: item.sourceSnapshot.source.title ?? item.sourceSnapshot.source.canonicalKey })) });
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
    const claims = await prisma.claim.findMany({ where: { runId: run.id, status: "active" }, include: { question: { select: { id: true, title: true, question: true, priority: true } }, evidenceRelations: { include: { evidence: { include: { sourceSnapshot: { include: { source: true } } } } } } }, orderBy: { createdAt: "asc" } });
    const evidence = await prisma.evidence.findMany({ where: { runId: run.id, status: "active" }, include: { sourceSnapshot: { include: { source: true } } }, orderBy: { createdAt: "asc" } });
    const sourceSnapshots = [...new Set(evidence.map((item) => item.sourceSnapshotId))];
    let verifierDecision: ResearchVerifierDecision = { claims: {} };
    if (state.modelCalls < limits.modelCalls && (state.totalTokens ?? 0) < limits.maxTokens && (state.costCredits ?? 0) < limits.maxCostCredits) {
      const verifierResult = await runResearchModelStage<ResearchVerifierDecision>({
        role: "research.verifier",
        userId: context.execution.userId,
        conversationId: context.execution.conversationId,
        projectId: run.workspace.projectId,
        signal: context.signal,
        prompt: [
          "你是 LumenLab Citation Verifier。只返回 JSON，不要 Markdown，不要隐藏推理，也不要联网。",
          "格式：{\"claims\":{\"claimId\":{\"status\":\"verified|needs_qualification|unsupported|conflicted\",\"reasonCode\":\"机器可处理原因\"}}}。",
          "逐条检查来源是否属于当前 Run、Evidence 是否直接支持 Claim、范围/日期/因果是否夸大，以及是否存在反驳或需要限定的措辞。",
          `领域 Profile：${JSON.stringify(domainProfile ?? {})}`,
          `Claims 与 Evidence：${JSON.stringify(claims.map((claim) => ({ id: claim.id, statement: claim.statement, relations: claim.evidenceRelations.map((relation) => ({ relation: relation.relation, statement: relation.evidence.statement, excerpt: relation.evidence.excerpt, sourceSnapshotId: relation.evidence.sourceSnapshotId })) })))}`,
        ].join("\n"),
      });
      recordResearchModelStage(state, verifierResult);
      verifierDecision = normalizeResearchVerifierDecision(verifierResult.value);
      await context.saveCheckpoint(checkpointWithResearch(checkpoint, state));
    }
    const claimStatuses = Object.fromEntries(claims.map((claim) => {
      const hasContradiction = claim.evidenceRelations.some((relation) => relation.relation === "contradicts");
      const fallbackStatus = claim.evidenceRelations.length === 0 ? "unsupported" : hasContradiction ? "conflicted" : "verified";
      const modelStatus = verifierDecision.claims[claim.id]?.status;
      const status = fallbackStatus === "unsupported" || fallbackStatus === "conflicted" ? fallbackStatus : modelStatus ?? fallbackStatus;
      return [claim.id, { status, reasonCode: verifierDecision.claims[claim.id]?.reasonCode ?? "deterministic_relation_check" }];
    }));
    const unsupportedClaims = claims.filter((claim) => claimStatuses[claim.id]?.status === "unsupported");
    const conflictedClaims = claims.filter((claim) => claimStatuses[claim.id]?.status === "conflicted");
    const qualifiedClaims = claims.filter((claim) => claimStatuses[claim.id]?.status === "needs_qualification");
    const citationMap = Object.fromEntries(claims.map((claim) => [claim.id, claim.evidenceRelations.map((relation) => ({ evidenceId: relation.evidenceId, sourceSnapshotId: relation.evidence.sourceSnapshotId, relation: relation.relation }))]));
    for (const claim of claims) await prisma.claim.update({ where: { id: claim.id }, data: { verificationStatus: claimStatuses[claim.id]?.status } });
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
    const report = await prisma.researchReportSnapshot.create({ data: { workspaceId: run.workspaceId, runId: run.id, planVersionId: run.planVersionId, reportDocument: json(reportDocument), claimSnapshots: json(claims.map((claim) => ({ id: claim.id, statement: claim.statement, verificationStatus: claimStatuses[claim.id]?.status ?? "unsupported", reasonCode: claimStatuses[claim.id]?.reasonCode }))), evidenceIds: evidence.map((item) => item.id), sourceSnapshotIds: sourceSnapshots, citationMap: json(citationMap), coverageSummary: json({ questionCount: claims.length, evidenceCount: evidence.length, sourceCount: sourceSnapshots.length }), verificationSummary: json(verificationSummary), modelConfiguration: json(run.modelConfiguration ?? {}), contentHash } });
    await prisma.researchRun.update({ where: { id: run.id }, data: { status: "completed", completedAt: new Date(), metrics: json({ evidenceCount: evidence.length, sourceCount: sourceSnapshots.length, claimCount: claims.length, modelCalls: state.modelCalls, promptTokens: state.promptTokens ?? 0, completionTokens: state.completionTokens ?? 0, totalTokens: state.totalTokens ?? 0, costCredits: state.costCredits ?? 0, verificationRepairs: state.verificationRepairs, verificationSummary }) } });
    await appendPublicEvent(context, { key: "research:report:completed", kind: "report_completed", runId: run.id, message: "研究报告已完成并冻结为不可修改快照", publicData: { reportId: report.id, evidenceCount: evidence.length, sourceCount: sourceSnapshots.length, verificationSummary } });
    return { kind: "completed", checkpoint };
  };
}
