import { prisma } from "@/lib/db";
import {
  ResearchBudgetProfile as PrismaResearchBudgetProfile,
  ResearchRunStatus as PrismaResearchRunStatus,
} from "@/generated/prisma/client";
import { getResearchBudget } from "./budget";
import { buildResearchPlan, applyResearchDirective, classifyResearchDirective } from "./plan";
import { assertResearchRunTransition } from "./state-machine";
import { createResearchAgentExecution } from "./durable-dispatcher";
import type { ResearchBudgetProfile, ResearchRunStatus } from "./contracts";

export class ResearchServiceError extends Error {
  constructor(public readonly code: "NOT_FOUND" | "INVALID_STATE" | "INVALID_INPUT", message: string) {
    super(message);
  }
}

function asBudgetProfile(value: string | undefined, fallback: ResearchBudgetProfile): ResearchBudgetProfile {
  return value === "quick" || value === "deep" || value === "comprehensive" ? value : fallback;
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
  return prisma.researchWorkspace.create({
    data: {
      userId: input.userId,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      projectId: input.projectId || null,
      domainProfileKey: input.domainProfileKey?.trim() || "general",
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

  return prisma.$transaction(async (tx) => {
    const run = await tx.researchRun.create({
      data: {
        workspaceId: workspace.id,
        userId: input.userId,
        followUpOfId: input.followUpOfId ?? null,
        question: plan.researchGoal,
        status: "awaiting_confirmation",
        budgetSnapshot: JSON.parse(JSON.stringify(budget)),
        modelConfiguration: {
          planner: "research.planner",
          worker: "research.worker",
          evaluator: "research.evaluator",
          synthesizer: "research.synthesizer",
          verifier: "research.verifier",
        },
      },
    });
    const planVersion = await tx.researchPlanVersion.create({
      data: {
        workspaceId: workspace.id,
        runId: run.id,
        version: 1,
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
    return { ...queued, agentExecutionId };
  } catch (error) {
    await prisma.researchRun.update({ where: { id: runId }, data: { status: "failed", completedAt: new Date(), metrics: { dispatchError: error instanceof Error ? error.message : "dispatch failed" } } });
    throw error;
  }
}

export async function appendResearchDirective(input: { userId: string; runId: string; text: string }) {
  const run = await prisma.researchRun.findFirst({ where: { id: input.runId, userId: input.userId } });
  if (!run) throw new ResearchServiceError("NOT_FOUND", "研究运行不存在或无权访问");
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
  if (needsConfirmation && run.status !== "completed" && run.status !== "cancelled" && run.status !== "failed") {
    await prisma.researchRun.update({ where: { id: run.id }, data: { status: "awaiting_scope_confirmation" } });
  }
  return directive;
}

export async function cancelResearchRun(userId: string, runId: string) {
  const run = await prisma.researchRun.findFirst({ where: { id: runId, userId }, select: { status: true } });
  if (!run) throw new ResearchServiceError("NOT_FOUND", "研究运行不存在或无权访问");
  assertResearchRunTransition(run.status as ResearchRunStatus, "cancelled");
  return prisma.researchRun.update({ where: { id: runId }, data: { status: "cancelled", completedAt: new Date() } });
}

export async function createFollowUpResearchRun(userId: string, runId: string, question: string) {
  const run = await prisma.researchRun.findFirst({ where: { id: runId, userId }, select: { workspaceId: true, status: true } });
  if (!run) throw new ResearchServiceError("NOT_FOUND", "研究运行不存在或无权访问");
  if (run.status !== "completed" && run.status !== "failed") {
    throw new ResearchServiceError("INVALID_STATE", "只有已完成或失败的运行可以创建 Follow-up Run");
  }
  return createResearchRun({ userId, workspaceId: run.workspaceId, question, followUpOfId: runId });
}

export async function getResearchRun(userId: string, runId: string) {
  const run = await prisma.researchRun.findFirst({
    where: { id: runId, userId },
    include: {
      workspace: { select: { id: true, name: true, projectId: true } },
      activePlanVersion: true,
      questions: { orderBy: { orderIndex: "asc" } },
      tasks: { orderBy: { createdAt: "asc" } },
      directives: { orderBy: { createdAt: "asc" } },
      reportSnapshot: true,
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
