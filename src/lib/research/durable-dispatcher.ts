import { createHash } from "node:crypto";
import type { AgentModel } from "@/lib/agent/contracts";
import { PrismaAgentExecutionStore } from "@/lib/agent/executions/prisma-agent-execution-store";
import { parseAgentCheckpoint, type AgentCheckpoint } from "@/lib/agent/executions/agent-execution-store";
import { prisma } from "@/lib/db";
import { selectResearchModel, type ResearchModelSelection } from "./model-routing";

function researchCheckpoint(input: { runId: string; question: string; selection: ResearchModelSelection; stage: "planning" | "researching" }): AgentCheckpoint {
  return parseAgentCheckpoint({
    version: 1,
    messages: [{ role: "user", content: input.question }],
    round: 0,
    model: { provider: input.selection.provider, name: input.selection.model },
    skill: { id: null, version: null },
    rag: { sourceIds: [], selectedFileIds: [] },
    allowedToolIds: ["web.search", "web.fetch", "arxiv.search", "arxiv.read", "arxiv.fetch", "project_rag.search", "project_files.read"],
    request: {
      message: input.question,
      model: input.selection.model,
      thinkingEnabled: false,
      reasoningEffort: input.selection.reasoningEffort,
      webSearchActive: true,
      skillOff: true,
      isQuickTask: false,
      executionKind: "research",
      researchRunId: input.runId,
    },
    researchState: {
      stage: input.stage,
      modelCalls: 0,
      searchCalls: 0,
      fetchCalls: 0,
      sourceCount: 0,
      replanCount: 0,
      verificationRepairs: 0,
    },
  });
}

export async function createResearchAgentExecution(userId: string, runId: string, options?: { stage?: "planning" | "researching" }) {
  const run = await prisma.researchRun.findFirst({ where: { id: runId, userId }, include: { workspace: true } });
  if (!run) throw new Error("Research Run 不存在或无权访问");
  if (run.agentExecutionId) return run.agentExecutionId;

  const selection = selectResearchModel("research.worker");
  const model: AgentModel = selection.model;
  const checkpoint = researchCheckpoint({ runId: run.id, question: run.question, selection, stage: options?.stage ?? "researching" });
  const clientRunKey = `research:${run.id}:v1`;
  const requestHash = createHash("sha256").update(JSON.stringify({ runId: run.id, question: run.question, planVersionId: run.planVersionId })).digest("hex");
  const result = await new PrismaAgentExecutionStore().createOrGetByClientRunKey({
    userId,
    clientRunKey,
    requestHash,
    conversation: {
      projectId: run.workspace.projectId,
      title: `深度研究：${run.question.slice(0, 80)}`,
      model,
      thinkingEnabled: false,
      kind: "research-system",
    },
    userMessageContent: run.question,
    checkpoint,
  });
  await prisma.researchRun.update({ where: { id: run.id }, data: { agentExecutionId: result.execution.id } });
  return result.execution.id;
}

export async function resumeResearchAgentExecution(userId: string, runId: string) {
  const run = await prisma.researchRun.findFirst({
    where: { id: runId, userId },
    select: { agentExecutionId: true },
  });
  if (!run?.agentExecutionId) return false;

  const now = new Date();
  return new PrismaAgentExecutionStore().resumeOwned({
    executionId: run.agentExecutionId,
    userId,
    now,
    scheduledAt: now,
  });
}
