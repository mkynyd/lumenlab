import { prisma } from "@/lib/db";
import {
  ResearchBudgetProfile as PrismaResearchBudgetProfile,
  ResearchEvidenceType as PrismaResearchEvidenceType,
  ClaimEvidenceRelationType as PrismaClaimEvidenceRelationType,
  ResearchRunStatus as PrismaResearchRunStatus,
} from "@/generated/prisma/client";
import { getResearchBudget } from "./budget";
import { buildResearchPlan, applyResearchDirective, classifyResearchDirective } from "./plan";
import { assertResearchRunTransition } from "./state-machine";
import { createResearchAgentExecution, resumeResearchAgentExecution } from "./durable-dispatcher";
import type { ResearchBudgetProfile, ResearchPlanSnapshot, ResearchRunStatus } from "./contracts";
import { applyConfirmedScopeDirectives, assertBudgetExpansion } from "./scope-confirmation";
import { assertEvidenceRevisionInput, normalizeEvidenceTags, isUserEditableEvidenceStatus } from "./evidence";
import { researchModelConfiguration } from "./model-routing";
import { resolveResearchDomainProfile } from "./domain-profile";

export class ResearchServiceError extends Error {
  constructor(public readonly code: "NOT_FOUND" | "INVALID_STATE" | "INVALID_INPUT", message: string) {
    super(message);
  }
}

function asBudgetProfile(value: string | undefined, fallback: ResearchBudgetProfile): ResearchBudgetProfile {
  return value === "quick" || value === "deep" || value === "comprehensive" ? value : fallback;
}

function isBudgetProfile(value: unknown): value is ResearchBudgetProfile {
  return value === "quick" || value === "deep" || value === "comprehensive";
}

function planFromJson(value: unknown): ResearchPlanSnapshot {
  return value as ResearchPlanSnapshot;
}

function cloneJson(value: unknown) {
  return value === null || value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function inheritedClaimQuality(value: unknown, fromRunId: string) {
  const base = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return { ...base, inheritedFromRunId: fromRunId };
}

/**
 * Follow-up Runs get new run-owned Snapshot/Evidence/Claim rows. The original
 * Run remains immutable, while the copied rows make the prior research usable
 * by the new Run's evaluator and synthesizer without cross-Run joins.
 */
async function inheritFollowUpResearchAssets(input: { userId: string; workspaceId: string; fromRunId: string; toRunId: string }) {
  const [sourceRun, questions] = await Promise.all([
    prisma.researchRun.findFirst({
      where: { id: input.fromRunId, userId: input.userId, workspaceId: input.workspaceId },
      select: {
        id: true,
        sourceSnapshots: { where: { status: "fetched" }, orderBy: { createdAt: "asc" }, select: { id: true, sourceId: true, retrievedAt: true, contentHash: true, sourceVersion: true, rawContentLocation: true, excerpt: true, metadata: true } },
        evidence: { where: { status: { in: ["active", "disputed"] } }, orderBy: { createdAt: "asc" }, select: { id: true, questionId: true, sourceSnapshotId: true, statement: true, locator: true, excerpt: true, evidenceType: true, origin: true, createdByUserId: true, tags: true, provenance: true, status: true } },
        claims: { where: { status: { in: ["active", "disputed"] } }, orderBy: { createdAt: "asc" }, select: { id: true, questionId: true, statement: true, status: true, userEdited: true, quality: true, evidenceRelations: { select: { evidenceId: true, relation: true, confidence: true, rationale: true } } } },
      },
    }),
    prisma.researchQuestion.findMany({ where: { runId: input.toRunId }, orderBy: { orderIndex: "asc" }, select: { id: true, priority: true } }),
  ]);
  if (!sourceRun) throw new ResearchServiceError("NOT_FOUND", "继承来源的 Research Run 不存在或无权访问");
  const contextQuestionId = questions.find((question) => question.priority === "critical")?.id ?? questions[0]?.id ?? null;

  return prisma.$transaction(async (tx) => {
    const snapshotIds = new Map<string, string>();
    for (const snapshot of sourceRun.sourceSnapshots) {
      const copied = await tx.researchSourceSnapshot.upsert({
        where: { runId_sourceId_contentHash: { runId: input.toRunId, sourceId: snapshot.sourceId, contentHash: snapshot.contentHash } },
        create: {
          workspaceId: input.workspaceId,
          runId: input.toRunId,
          sourceId: snapshot.sourceId,
          retrievedAt: snapshot.retrievedAt,
          contentHash: snapshot.contentHash,
          sourceVersion: snapshot.sourceVersion,
          rawContentLocation: cloneJson(snapshot.rawContentLocation),
          excerpt: snapshot.excerpt,
          metadata: cloneJson(snapshot.metadata),
          status: "fetched",
        },
        update: {},
        select: { id: true },
      });
      snapshotIds.set(snapshot.id, copied.id);
    }

    const evidenceIds = new Map<string, string>();
    for (const evidence of sourceRun.evidence) {
      const sourceSnapshotId = snapshotIds.get(evidence.sourceSnapshotId);
      if (!sourceSnapshotId) continue;
      const copied = await tx.evidence.create({
        data: {
          workspaceId: input.workspaceId,
          runId: input.toRunId,
          questionId: contextQuestionId,
          sourceSnapshotId,
          statement: evidence.statement,
          locator: cloneJson(evidence.locator),
          excerpt: evidence.excerpt,
          evidenceType: evidence.evidenceType,
          origin: evidence.origin,
          createdByUserId: evidence.createdByUserId,
          tags: evidence.tags,
          provenance: {
            actor: "follow_up_inheritance",
            inheritedFromRunId: sourceRun.id,
            inheritedFromEvidenceId: evidence.id,
            originalProvenance: cloneJson(evidence.provenance) ?? null,
          },
          status: evidence.status,
        },
        select: { id: true },
      });
      evidenceIds.set(evidence.id, copied.id);
    }

    let copiedClaimCount = 0;
    for (const claim of sourceRun.claims) {
      const copiedClaim = await tx.claim.create({
        data: {
          workspaceId: input.workspaceId,
          runId: input.toRunId,
          questionId: contextQuestionId,
          statement: claim.statement,
          status: claim.status,
          userEdited: claim.userEdited,
          verificationStatus: "pending",
          quality: inheritedClaimQuality(claim.quality, sourceRun.id),
        },
        select: { id: true },
      });
      const relations = claim.evidenceRelations.flatMap((relation) => {
        const evidenceId = evidenceIds.get(relation.evidenceId);
        return evidenceId ? [{ claimId: copiedClaim.id, evidenceId, relation: relation.relation, confidence: relation.confidence, rationale: relation.rationale }] : [];
      });
      if (relations.length > 0) await tx.claimEvidenceRelation.createMany({ data: relations, skipDuplicates: true });
      copiedClaimCount += 1;
    }

    await tx.researchRun.update({
      where: { id: input.toRunId },
      data: { metrics: { inheritedFromRunId: sourceRun.id, inheritedSourceSnapshotCount: snapshotIds.size, inheritedEvidenceCount: evidenceIds.size, inheritedClaimCount: copiedClaimCount } },
    });
    return { sourceSnapshotCount: snapshotIds.size, evidenceCount: evidenceIds.size, claimCount: copiedClaimCount };
  });
}

export async function listResearchWorkspaces(userId: string) {
  return prisma.researchWorkspace.findMany({
    where: { userId, status: "active" },
    orderBy: { updatedAt: "desc" },
    include: {
      project: { select: { id: true, name: true } },
      runs: {
        orderBy: { updatedAt: "desc" },
        take: 5,
        select: { id: true, question: true, status: true, createdAt: true, updatedAt: true },
      },
      _count: { select: { runs: true, sources: true, evidence: true } },
    },
  });
}

export async function getResearchWorkspace(userId: string, workspaceId: string) {
  const workspace = await prisma.researchWorkspace.findFirst({
    where: { id: workspaceId, userId },
    include: {
      project: { select: { id: true, name: true } },
      runs: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          question: true,
          status: true,
          budgetSnapshot: true,
          startedAt: true,
          completedAt: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { questions: true, tasks: true, evidence: true, claims: true } },
        },
      },
      _count: { select: { runs: true, sources: true, evidence: true, claims: true } },
    },
  });
  if (!workspace) throw new ResearchServiceError("NOT_FOUND", "研究工作区不存在或无权访问");
  return workspace;
}

export async function createResearchWorkspace(input: {
  userId: string;
  name: string;
  description?: string | null;
  projectId?: string | null;
  domainProfileKey?: string;
  budgetProfile?: ResearchBudgetProfile;
}) {
  if (input.projectId) {
    const project = await prisma.project.findFirst({ where: { id: input.projectId, userId: input.userId }, select: { id: true } });
    if (!project) throw new ResearchServiceError("NOT_FOUND", "项目不存在或无权访问");
  }
  const domainProfile = resolveResearchDomainProfile(input.domainProfileKey);
  return prisma.researchWorkspace.create({
    data: {
      userId: input.userId,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      projectId: input.projectId || null,
      domainProfileKey: domainProfile.key,
      budgetProfile: input.budgetProfile as PrismaResearchBudgetProfile | undefined,
    },
    include: { project: { select: { id: true, name: true } } },
  });
}

export async function createResearchRun(input: {
  userId: string;
  workspaceId: string;
  question: string;
  budgetProfile?: ResearchBudgetProfile;
  followUpOfId?: string | null;
}) {
  const workspace = await prisma.researchWorkspace.findFirst({ where: { id: input.workspaceId, userId: input.userId } });
  if (!workspace) throw new ResearchServiceError("NOT_FOUND", "研究工作区不存在或无权访问");
  const profile = input.budgetProfile ?? workspace.budgetProfile;
  const plan = buildResearchPlan({ question: input.question, profile, domainProfileKey: workspace.domainProfileKey });
  const budget = getResearchBudget(profile);

  const created = await prisma.$transaction(async (tx) => {
    const run = await tx.researchRun.create({
      data: {
        workspaceId: workspace.id,
        userId: input.userId,
        followUpOfId: input.followUpOfId ?? null,
        question: plan.researchGoal,
        status: "planning",
        budgetSnapshot: JSON.parse(JSON.stringify(budget)),
        modelConfiguration: JSON.parse(JSON.stringify(researchModelConfiguration())),
      },
    });
    const maxPlanVersion = await tx.researchPlanVersion.aggregate({ where: { workspaceId: workspace.id }, _max: { version: true } });
    const planVersion = await tx.researchPlanVersion.create({
      data: {
        workspaceId: workspace.id,
        runId: run.id,
        version: (maxPlanVersion._max.version ?? 0) + 1,
        plan: JSON.parse(JSON.stringify(plan)),
      },
    });
    await tx.researchRun.update({ where: { id: run.id }, data: { planVersionId: planVersion.id } });
    await tx.researchQuestion.createMany({
      data: plan.researchQuestions.map((item, index) => ({
        runId: run.id,
        key: item.key,
        title: item.title,
        question: item.question,
        priority: item.priority,
        orderIndex: index,
        completionCriteria: item.completionCriteria,
        sourceStrategy: item.sourceStrategy,
      })),
    });
    return tx.researchRun.findUniqueOrThrow({
      where: { id: run.id },
      include: { activePlanVersion: true, questions: { orderBy: { orderIndex: "asc" } } },
    });
  });
  try {
    await createResearchAgentExecution(input.userId, created.id, { stage: "planning" });
    return prisma.researchRun.findUniqueOrThrow({
      where: { id: created.id },
      include: { activePlanVersion: true, questions: { orderBy: { orderIndex: "asc" } } },
    });
  } catch (error) {
    await prisma.researchRun.update({ where: { id: created.id }, data: { status: "failed", completedAt: new Date(), metrics: { planningDispatchError: error instanceof Error ? error.message : "planning dispatch failed" } } });
    throw error;
  }
}

export async function reviseResearchPlan(input: {
  userId: string;
  runId: string;
  directive: string;
}) {
  const run = await prisma.researchRun.findFirst({
    where: { id: input.runId, userId: input.userId },
    include: { workspace: true, activePlanVersion: true, questions: true },
  });
  if (!run || !run.activePlanVersion) throw new ResearchServiceError("NOT_FOUND", "研究运行不存在或计划不存在");
  if (run.status !== "awaiting_confirmation" && run.status !== "planning") {
    throw new ResearchServiceError("INVALID_STATE", "当前运行已经开始，不能直接修改初始计划");
  }
  const currentPlan = run.activePlanVersion.plan as unknown as Parameters<typeof applyResearchDirective>[0];
  const revisedPlan = applyResearchDirective(currentPlan, input.directive);
  return prisma.$transaction(async (tx) => {
    const maxVersion = await tx.researchPlanVersion.aggregate({ where: { workspaceId: run.workspaceId }, _max: { version: true } });
    const version = (maxVersion._max.version ?? 0) + 1;
    const planVersion = await tx.researchPlanVersion.create({
      data: { workspaceId: run.workspaceId, runId: run.id, version, plan: JSON.parse(JSON.stringify(revisedPlan)), reason: input.directive },
    });
    for (const [index, item] of revisedPlan.researchQuestions.entries()) {
      await tx.researchQuestion.upsert({
        where: { runId_key: { runId: run.id, key: item.key } },
        create: {
          runId: run.id,
          key: item.key,
          title: item.title,
          question: item.question,
          priority: item.priority,
          orderIndex: index,
          completionCriteria: item.completionCriteria,
          sourceStrategy: item.sourceStrategy,
        },
        update: {
          title: item.title,
          question: item.question,
          priority: item.priority,
          orderIndex: index,
          completionCriteria: item.completionCriteria,
          sourceStrategy: item.sourceStrategy,
        },
      });
    }
    await tx.researchRun.update({ where: { id: run.id }, data: { planVersionId: planVersion.id } });
    return planVersion;
  });
}

export async function confirmResearchRunPlan(userId: string, runId: string) {
  const run = await prisma.researchRun.findFirst({ where: { id: runId, userId }, include: { questions: true } });
  if (!run) throw new ResearchServiceError("NOT_FOUND", "研究运行不存在或无权访问");
  assertResearchRunTransition(run.status as ResearchRunStatus, "queued");
  const tasks = run.questions.map((question) => ({
    runId: run.id,
    questionId: question.id,
    kind: "researcher" as const,
    priority: question.priority,
    title: `研究：${question.title}`,
    instructions: question.question,
    idempotencyKey: `${run.id}:${question.key}:research:0`,
  }));
  const queued = await prisma.$transaction(async (tx) => {
    await tx.researchPlanVersion.updateMany({ where: { runId, confirmedAt: null }, data: { confirmedAt: new Date() } });
    await tx.researchTask.createMany({ data: tasks, skipDuplicates: true });
    return tx.researchRun.update({ where: { id: runId }, data: { status: "queued", startedAt: new Date() } });
  });
  try {
    const agentExecutionId = await createResearchAgentExecution(userId, runId);
    await resumeResearchAgentExecution(userId, runId);
    return { ...queued, agentExecutionId };
  } catch (error) {
    await prisma.researchRun.update({ where: { id: runId }, data: { status: "failed", completedAt: new Date(), metrics: { dispatchError: error instanceof Error ? error.message : "dispatch failed" } } });
    throw error;
  }
}

export async function appendResearchDirective(input: { userId: string; runId: string; text: string }) {
  const run = await prisma.researchRun.findFirst({ where: { id: input.runId, userId: input.userId } });
  if (!run) throw new ResearchServiceError("NOT_FOUND", "研究运行不存在或无权访问");
  if (run.status === "planning" || run.status === "awaiting_confirmation") {
    throw new ResearchServiceError("INVALID_STATE", "计划确认前请使用计划修订入口");
  }
  if (run.status === "completed" || run.status === "cancelled" || run.status === "failed") {
    throw new ResearchServiceError("INVALID_STATE", "终态运行不能追加执行指令，请创建 Follow-up Run");
  }
  const impact = classifyResearchDirective(input.text);
  const needsConfirmation = impact !== "normal";
  const directive = await prisma.researchUserDirective.create({
    data: {
      workspaceId: run.workspaceId,
      runId: run.id,
      userId: input.userId,
      text: input.text.trim(),
      impact,
      status: needsConfirmation ? "needs_confirmation" : "applied",
      appliedAt: needsConfirmation ? null : new Date(),
    },
  });
  if (needsConfirmation) {
    if (run.status !== "awaiting_scope_confirmation") {
      try {
        assertResearchRunTransition(run.status as ResearchRunStatus, "awaiting_scope_confirmation");
      } catch (error) {
        throw new ResearchServiceError("INVALID_STATE", error instanceof Error ? error.message : "当前阶段不能暂停等待范围确认");
      }
    }
    await prisma.researchRun.update({ where: { id: run.id }, data: { status: "awaiting_scope_confirmation" } });
  }
  return directive;
}

export async function confirmResearchScope(input: {
  userId: string;
  runId: string;
  approved: boolean;
  budgetProfile?: ResearchBudgetProfile;
}) {
  const run = await prisma.researchRun.findFirst({
    where: { id: input.runId, userId: input.userId },
    include: {
      workspace: true,
      activePlanVersion: true,
      questions: { select: { key: true } },
      directives: { where: { status: "needs_confirmation" }, orderBy: { createdAt: "asc" } },
      agentExecution: { select: { id: true, status: true } },
    },
  });
  if (!run) throw new ResearchServiceError("NOT_FOUND", "研究运行不存在或无权访问");
  if (run.status !== "awaiting_scope_confirmation") {
    throw new ResearchServiceError("INVALID_STATE", "当前运行没有等待范围确认");
  }
  if (!run.activePlanVersion) {
    throw new ResearchServiceError("INVALID_STATE", "研究运行缺少有效计划快照");
  }
  const activePlanVersion = run.activePlanVersion;
  if (run.directives.length === 0) {
    throw new ResearchServiceError("INVALID_STATE", "没有待确认的研究指令");
  }

  const currentPlan = planFromJson(activePlanVersion.plan);
  const currentBudget = isBudgetProfile(currentPlan.researchIntensity)
    ? currentPlan.researchIntensity
    : run.workspace.budgetProfile;
  const hasBudgetExpansion = run.directives.some((directive) => directive.impact === "budget_expansion");
  const nextBudget = input.approved ? input.budgetProfile ?? currentBudget : currentBudget;
  if (input.approved && hasBudgetExpansion) {
    if (!input.budgetProfile) {
      throw new ResearchServiceError("INVALID_INPUT", "确认预算扩大时必须选择新的预算配置");
    }
    try {
      assertBudgetExpansion(currentBudget, input.budgetProfile);
    } catch (error) {
      throw new ResearchServiceError("INVALID_INPUT", error instanceof Error ? error.message : "新的预算配置无效");
    }
  }

  const scopeDirectives = input.approved
    ? run.directives.filter((directive) => directive.impact === "scope_expansion").map((directive) => directive.text)
    : [];
  const nextPlan = input.approved
    ? applyConfirmedScopeDirectives(currentPlan, scopeDirectives, nextBudget)
    : currentPlan;
  const existingQuestionKeys = new Set(run.questions.map((question) => question.key));
  const addedQuestions = nextPlan.researchQuestions.filter((question) => !existingQuestionKeys.has(question.key));
  if (input.approved && scopeDirectives.length > 0 && addedQuestions.length === 0) {
    throw new ResearchServiceError("INVALID_INPUT", "当前运行已经达到最多八个研究问题，无法继续扩大范围");
  }

  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    let planVersionId = activePlanVersion.id;
    if (input.approved && (scopeDirectives.length > 0 || nextBudget !== currentBudget)) {
      const maxVersion = await tx.researchPlanVersion.aggregate({ where: { workspaceId: run.workspaceId }, _max: { version: true } });
      const planVersion = await tx.researchPlanVersion.create({
        data: {
          workspaceId: run.workspaceId,
          runId: run.id,
          version: (maxVersion._max.version ?? 0) + 1,
          plan: JSON.parse(JSON.stringify(nextPlan)),
          reason: run.directives.map((directive) => directive.text).join("；"),
          confirmedAt: now,
        },
      });
      planVersionId = planVersion.id;
      await tx.researchRun.update({ where: { id: run.id }, data: { planVersionId } });
      await tx.researchQuestion.createMany({
        data: addedQuestions.map((question, index) => ({
          runId: run.id,
          key: question.key,
          title: question.title,
          question: question.question,
          priority: question.priority,
          orderIndex: run.questions.length + index,
          completionCriteria: question.completionCriteria,
          sourceStrategy: question.sourceStrategy,
        })),
        skipDuplicates: true,
      });
      const questionRows = addedQuestions.length > 0
        ? await tx.researchQuestion.findMany({ where: { runId: run.id, key: { in: addedQuestions.map((question) => question.key) } }, select: { id: true, key: true, title: true, question: true, priority: true } })
        : [];
      await tx.researchTask.createMany({
        data: questionRows.map((question) => ({
          runId: run.id,
          questionId: question.id,
          kind: "researcher" as const,
          priority: question.priority,
          title: `补充研究：${question.title}`,
          instructions: question.question,
          idempotencyKey: `${run.id}:${question.key}:research:scope-confirmed`,
        })),
        skipDuplicates: true,
      });
    }

    await tx.researchUserDirective.updateMany({
      where: { id: { in: run.directives.map((directive) => directive.id) } },
      data: { status: input.approved ? "applied" : "rejected", appliedAt: input.approved ? now : null },
    });
    return tx.researchRun.update({
      where: { id: run.id },
      data: {
        status: "queued",
        budgetSnapshot: input.approved ? JSON.parse(JSON.stringify(getResearchBudget(nextBudget))) : undefined,
      },
      include: { activePlanVersion: true },
    });
  });

  const resumed = await resumeResearchAgentExecution(input.userId, run.id);
  return { run: result, resumed, planVersionId: result.planVersionId };
}

const RESEARCH_EVIDENCE_TYPES = new Set<PrismaResearchEvidenceType>([
  "direct_quote",
  "paraphrase",
  "dataset_measurement",
  "project_context",
  "expert_assessment",
]);

function parseEvidenceType(value: string): PrismaResearchEvidenceType {
  if (!RESEARCH_EVIDENCE_TYPES.has(value as PrismaResearchEvidenceType)) {
    throw new ResearchServiceError("INVALID_INPUT", "Evidence type 无效");
  }
  return value as PrismaResearchEvidenceType;
}

const evidenceInclude = {
  sourceSnapshot: {
    select: {
      id: true,
      retrievedAt: true,
      excerpt: true,
      source: { select: { id: true, title: true, canonicalKey: true, canonicalUrl: true, doi: true, arxivId: true, pmid: true } },
    },
  },
} as const;

export async function listResearchEvidence(userId: string, runId: string) {
  const run = await prisma.researchRun.findFirst({ where: { id: runId, userId }, select: { id: true } });
  if (!run) throw new ResearchServiceError("NOT_FOUND", "研究运行不存在或无权访问");
  return prisma.evidence.findMany({
    where: { runId, status: { in: ["active", "disputed"] } },
    orderBy: { createdAt: "asc" },
    include: evidenceInclude,
  });
}

export async function createUserEvidence(input: {
  userId: string;
  runId: string;
  sourceSnapshotId: string;
  questionId?: string | null;
  statement: string;
  excerpt: string;
  locator: Record<string, unknown>;
  evidenceType: string;
  tags?: string[];
}) {
  const evidenceType = parseEvidenceType(input.evidenceType);
  try {
    assertEvidenceRevisionInput({ statement: input.statement, excerpt: input.excerpt, evidenceType });
  } catch (error) {
    throw new ResearchServiceError("INVALID_INPUT", error instanceof Error ? error.message : "Evidence 内容无效");
  }
  const run = await prisma.researchRun.findFirst({
    where: { id: input.runId, userId: input.userId },
    select: { id: true, workspaceId: true },
  });
  if (!run) throw new ResearchServiceError("NOT_FOUND", "研究运行不存在或无权访问");
  const snapshot = await prisma.researchSourceSnapshot.findFirst({
    where: { id: input.sourceSnapshotId, runId: run.id, workspaceId: run.workspaceId },
    select: { id: true },
  });
  if (!snapshot) throw new ResearchServiceError("INVALID_INPUT", "Evidence 必须关联本次研究已读取的 Source Snapshot");
  if (input.questionId) {
    const question = await prisma.researchQuestion.findFirst({ where: { id: input.questionId, runId: run.id }, select: { id: true } });
    if (!question) throw new ResearchServiceError("INVALID_INPUT", "Research Question 不属于当前 Run");
  }
  return prisma.evidence.create({
    data: {
      workspaceId: run.workspaceId,
      runId: run.id,
      questionId: input.questionId ?? null,
      sourceSnapshotId: snapshot.id,
      statement: input.statement.trim(),
      locator: JSON.parse(JSON.stringify(input.locator)),
      excerpt: input.excerpt.trim(),
      evidenceType,
      origin: "user",
      createdByUserId: input.userId,
      tags: normalizeEvidenceTags(input.tags),
      provenance: { actor: "user", action: "created" },
    },
    include: evidenceInclude,
  });
}

export async function reviseResearchEvidence(input: {
  userId: string;
  runId: string;
  evidenceId: string;
  statement: string;
  excerpt: string;
  locator: Record<string, unknown>;
  evidenceType: string;
  tags?: string[];
  sourceSnapshotId?: string;
  revisionReason?: string;
}) {
  const evidenceType = parseEvidenceType(input.evidenceType);
  try {
    assertEvidenceRevisionInput({ statement: input.statement, excerpt: input.excerpt, evidenceType });
  } catch (error) {
    throw new ResearchServiceError("INVALID_INPUT", error instanceof Error ? error.message : "Evidence 修订内容无效");
  }
  const existing = await prisma.evidence.findFirst({
    where: { id: input.evidenceId, runId: input.runId, workspace: { userId: input.userId } },
    select: { id: true, workspaceId: true, runId: true, questionId: true, sourceSnapshotId: true, status: true },
  });
  if (!existing) throw new ResearchServiceError("NOT_FOUND", "Evidence 不存在或无权访问");
  if (existing.status === "superseded") throw new ResearchServiceError("INVALID_STATE", "不能继续修订已经被替代的 Evidence");
  const sourceSnapshotId = input.sourceSnapshotId ?? existing.sourceSnapshotId;
  const snapshot = await prisma.researchSourceSnapshot.findFirst({ where: { id: sourceSnapshotId, runId: existing.runId, workspaceId: existing.workspaceId }, select: { id: true } });
  if (!snapshot) throw new ResearchServiceError("INVALID_INPUT", "修订后的 Evidence 必须关联当前 Run 的 Source Snapshot");
  const revisionReason = input.revisionReason?.trim().slice(0, 500) || null;
  return prisma.$transaction(async (tx) => {
    await tx.evidence.update({ where: { id: existing.id }, data: { status: "superseded" } });
    return tx.evidence.create({
      data: {
        workspaceId: existing.workspaceId,
        runId: existing.runId,
        questionId: existing.questionId,
        sourceSnapshotId: snapshot.id,
        statement: input.statement.trim(),
        locator: JSON.parse(JSON.stringify(input.locator)),
        excerpt: input.excerpt.trim(),
        evidenceType,
        origin: "user",
        createdByUserId: input.userId,
        tags: normalizeEvidenceTags(input.tags),
        provenance: { actor: "user", action: "revision", sourceEvidenceId: existing.id },
        supersedesId: existing.id,
        revisionReason,
      },
      include: evidenceInclude,
    });
  });
}

export async function updateResearchEvidenceStatus(input: { userId: string; evidenceId: string; status: string; runId?: string }) {
  if (!isUserEditableEvidenceStatus(input.status)) {
    throw new ResearchServiceError("INVALID_INPUT", "Evidence 只能被标记为 disputed 或 invalidated");
  }
  const evidence = await prisma.evidence.findFirst({ where: { id: input.evidenceId, ...(input.runId ? { runId: input.runId } : {}), workspace: { userId: input.userId } }, select: { id: true, status: true } });
  if (!evidence) throw new ResearchServiceError("NOT_FOUND", "Evidence 不存在或无权访问");
  if (evidence.status === "superseded") throw new ResearchServiceError("INVALID_STATE", "不能修改已经被替代的 Evidence");
  return prisma.evidence.update({ where: { id: evidence.id }, data: { status: input.status }, include: evidenceInclude });
}

const CLAIM_RELATIONS = new Set<PrismaClaimEvidenceRelationType>(["supports", "contradicts", "qualifies", "context"]);

export async function listResearchClaims(userId: string, runId: string) {
  const run = await prisma.researchRun.findFirst({ where: { id: runId, userId }, select: { id: true } });
  if (!run) throw new ResearchServiceError("NOT_FOUND", "研究运行不存在或无权访问");
  return prisma.claim.findMany({
    where: { runId, status: { in: ["active", "disputed"] } },
    orderBy: { createdAt: "asc" },
    include: { evidenceRelations: { include: { evidence: { select: { id: true, statement: true, status: true, sourceSnapshotId: true } } } } },
  });
}

export async function updateResearchClaim(input: { userId: string; runId: string; claimId: string; statement: string }) {
  const statement = input.statement.trim();
  if (statement.length < 3) throw new ResearchServiceError("INVALID_INPUT", "Claim 至少需要 3 个字符");
  const claim = await prisma.claim.findFirst({ where: { id: input.claimId, runId: input.runId, workspace: { userId: input.userId } }, select: { id: true } });
  if (!claim) throw new ResearchServiceError("NOT_FOUND", "Claim 不存在或无权访问");
  return prisma.claim.update({ where: { id: claim.id }, data: { statement, userEdited: true, verificationStatus: "pending", quality: { label: "待重新评估", reason: "用户编辑了 Claim" } }, include: { evidenceRelations: true } });
}

export async function upsertClaimEvidenceRelation(input: { userId: string; runId: string; claimId: string; evidenceId: string; relation: string; confidence?: number | null; rationale?: string | null }) {
  if (!CLAIM_RELATIONS.has(input.relation as PrismaClaimEvidenceRelationType)) throw new ResearchServiceError("INVALID_INPUT", "Claim/Evidence relation 无效");
  const [claim, evidence] = await Promise.all([
    prisma.claim.findFirst({ where: { id: input.claimId, runId: input.runId, workspace: { userId: input.userId } }, select: { id: true } }),
    prisma.evidence.findFirst({ where: { id: input.evidenceId, runId: input.runId, workspace: { userId: input.userId } }, select: { id: true } }),
  ]);
  if (!claim || !evidence) throw new ResearchServiceError("INVALID_INPUT", "Claim 和 Evidence 必须属于同一个当前 Run");
  const confidence = input.confidence === null || input.confidence === undefined ? null : Math.max(0, Math.min(1, input.confidence));
  return prisma.$transaction(async (tx) => {
    const relation = await tx.claimEvidenceRelation.upsert({ where: { claimId_evidenceId: { claimId: claim.id, evidenceId: evidence.id } }, create: { claimId: claim.id, evidenceId: evidence.id, relation: input.relation as PrismaClaimEvidenceRelationType, confidence, rationale: input.rationale?.trim() || null }, update: { relation: input.relation as PrismaClaimEvidenceRelationType, confidence, rationale: input.rationale?.trim() || null } });
    await tx.claim.update({ where: { id: claim.id }, data: { verificationStatus: "pending", quality: { label: "待重新评估", reason: "Evidence 关系已更新" } } });
    return relation;
  });
}

export async function cancelResearchRun(userId: string, runId: string) {
  const run = await prisma.researchRun.findFirst({ where: { id: runId, userId }, select: { status: true } });
  if (!run) throw new ResearchServiceError("NOT_FOUND", "研究运行不存在或无权访问");
  assertResearchRunTransition(run.status as ResearchRunStatus, "cancelled");
  return prisma.researchRun.update({ where: { id: runId }, data: { status: "cancelled", completedAt: new Date() } });
}

export async function createFollowUpResearchRun(userId: string, runId: string, question: string) {
  const run = await prisma.researchRun.findFirst({ where: { id: runId, userId }, select: { id: true, workspaceId: true, status: true } });
  if (!run) throw new ResearchServiceError("NOT_FOUND", "研究运行不存在或无权访问");
  if (run.status !== "completed" && run.status !== "failed") {
    throw new ResearchServiceError("INVALID_STATE", "只有已完成或失败的运行可以创建 Follow-up Run");
  }
  const followUp = await createResearchRun({ userId, workspaceId: run.workspaceId, question, followUpOfId: run.id });
  await inheritFollowUpResearchAssets({ userId, workspaceId: run.workspaceId, fromRunId: run.id, toRunId: followUp.id });
  return followUp;
}

export async function getResearchRun(userId: string, runId: string) {
  const run = await prisma.researchRun.findFirst({
    where: { id: runId, userId },
    select: {
      id: true,
      workspaceId: true,
      userId: true,
      followUpOfId: true,
      agentExecutionId: true,
      planVersionId: true,
      question: true,
      status: true,
      budgetSnapshot: true,
      metrics: true,
      startedAt: true,
      completedAt: true,
      createdAt: true,
      updatedAt: true,
      workspace: { select: { id: true, name: true, projectId: true } },
      activePlanVersion: true,
      questions: { orderBy: { orderIndex: "asc" }, select: { id: true, key: true, title: true, question: true, priority: true, status: true, completionCriteria: true, sourceStrategy: true, qualitySummary: true, researchAttempts: true, evaluateAttempts: true, replanAttempts: true } },
      tasks: { orderBy: { createdAt: "asc" }, select: { id: true, questionId: true, kind: true, status: true, priority: true, title: true, instructions: true, attempt: true, maxAttempts: true, startedAt: true, completedAt: true, createdAt: true, updatedAt: true } },
      directives: { orderBy: { createdAt: "asc" }, select: { id: true, text: true, impact: true, status: true, appliedAt: true, createdAt: true } },
      agentExecution: { select: { id: true, status: true, scheduledAt: true } },
      evidence: { where: { status: { in: ["active", "disputed"] } }, orderBy: { createdAt: "asc" }, take: 200, select: { id: true, questionId: true, sourceSnapshotId: true, statement: true, excerpt: true, locator: true, evidenceType: true, origin: true, status: true, tags: true, createdAt: true, sourceSnapshot: { select: { id: true, retrievedAt: true, excerpt: true, source: { select: { id: true, title: true, canonicalKey: true, canonicalUrl: true, doi: true, arxivId: true, pmid: true } } } } } },
      claims: { where: { status: { in: ["active", "disputed"] } }, orderBy: { createdAt: "asc" }, take: 100, select: { id: true, questionId: true, statement: true, status: true, userEdited: true, verificationStatus: true, quality: true, createdAt: true, updatedAt: true, evidenceRelations: { select: { evidenceId: true, relation: true, confidence: true, rationale: true, evidence: { select: { id: true, statement: true, status: true, sourceSnapshotId: true } } } } } },
      reportSnapshot: { select: { id: true, reportDocument: true, claimSnapshots: true, evidenceIds: true, sourceSnapshotIds: true, citationMap: true, coverageSummary: true, verificationSummary: true, modelConfiguration: true, generatedAt: true } },
      _count: { select: { sourceSnapshots: true, evidence: true, claims: true } },
    },
  });
  if (!run) throw new ResearchServiceError("NOT_FOUND", "研究运行不存在或无权访问");
  return run;
}

export async function getResearchRunStatus(userId: string, runId: string): Promise<ResearchRunStatus> {
  const run = await prisma.researchRun.findFirst({ where: { id: runId, userId }, select: { status: true } });
  if (!run) throw new ResearchServiceError("NOT_FOUND", "研究运行不存在或无权访问");
  return run.status as ResearchRunStatus;
}

export function parseBudgetProfile(value: string | undefined, fallback: ResearchBudgetProfile): ResearchBudgetProfile {
  return asBudgetProfile(value, fallback);
}

export function toPrismaRunStatus(status: ResearchRunStatus): PrismaResearchRunStatus {
  return status as PrismaResearchRunStatus;
}
