import { createHash } from "node:crypto";
import { PrismaAgentExecutionStore } from "@/lib/agent/executions/prisma-agent-execution-store";
import { parseAgentCheckpoint, type AgentCheckpoint } from "@/lib/agent/executions/agent-execution-store";
import { prisma } from "@/lib/db";

function researchCheckpoint(input: { runId: string; question: string; model: "deepseek-v4-flash" | "deepseek-v4-pro" }): AgentCheckpoint {
  return parseAgentCheckpoint({
    version: 1,
    messages: [{ role: "user", content: input.question }],
    round: 0,
    model: { provider: "deepseek", name: input.model },
    skill: { id: null, version: null },
    rag: { sourceIds: [], selectedFileIds: [] },
    allowedToolIds: ["web.search", "web.fetch", "arxiv.search", "arxiv.read", "arxiv.fetch", "project_rag.search", "project_files.read"],
    request: {
      message: input.question,
      model: input.model,
      thinkingEnabled: false,
      reasoningEffort: "high",
      webSearchActive: true,
      skillOff: true,
      isQuickTask: false,
      executionKind: "research",
      researchRunId: input.runId,
    },
    researchState: {
      stage: "researching",
      modelCalls: 0,
      searchCalls: 0,
      fetchCalls: 0,
      sourceCount: 0,
      replanCount: 0,
      verificationRepairs: 0,
    },
  });
}

export async function createResearchAgentExecution(userId: string, runId: string) {
  const run = await prisma.researchRun.findFirst({ where: { id: runId, userId }, include: { workspace: true } });
  if (!run) throw new Error("Research Run 不存在或无权访问");
  if (run.agentExecutionId) return run.agentExecutionId;

  const model = "deepseek-v4-flash" as const;
  const checkpoint = researchCheckpoint({ runId: run.id, question: run.question, model });
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
