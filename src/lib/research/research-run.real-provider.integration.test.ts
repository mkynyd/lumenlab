// @vitest-environment node

import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { startAgentExecutionWorker } from "@/lib/agent/executions/durable-agent-runtime";
import {
  confirmResearchRunPlan,
  createResearchRun,
  createResearchWorkspace,
} from "./service";

const enabled =
  process.env.RESEARCH_FULL_RUN_E2E === "1" &&
  Boolean(process.env.RESEARCH_E2E_USER_ID);

type WorkerGlobal = typeof globalThis & {
  __lumenAgentExecutionWorker?: { stop(): Promise<void> };
};

async function waitForRunStatus(
  runId: string,
  terminalStatuses: string[],
  timeoutMs: number
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await prisma.researchRun.findUnique({
      where: { id: runId },
      include: { reportSnapshot: true, agentExecution: true },
    });
    if (!run) throw new Error("Research E2E run disappeared");
    if (terminalStatuses.includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `Research E2E timed out waiting for ${terminalStatuses.join(", ")}`
  );
}

afterAll(async () => {
  await (globalThis as WorkerGlobal).__lumenAgentExecutionWorker?.stop();
});

describe("real Research durable run", () => {
  it.runIf(enabled)("plans, confirms, researches, verifies, and freezes a report", async () => {
    const userId = process.env.RESEARCH_E2E_USER_ID!;
    const workspace = await createResearchWorkspace({
      userId,
      name: `Research Responses E2E ${Date.now()}`,
      description: "Temporary task 06 verification workspace",
      budgetProfile: "quick",
    });
    let conversationId: string | null = null;

    try {
      const created = await createResearchRun({
        userId,
        workspaceId: workspace.id,
        budgetProfile: "quick",
        question:
          "What context window does the official DeepSeek V4 Flash Vision model advertise? Use verifiable public sources and state uncertainty.",
      });
      startAgentExecutionWorker();

      const planned = await waitForRunStatus(
        created.id,
        ["awaiting_confirmation", "failed"],
        90_000
      );
      expect(planned.status).toBe("awaiting_confirmation");
      conversationId = planned.agentExecution?.conversationId ?? null;
      const planningCheckpoint = planned.agentExecution?.checkpoint as
        | { version?: number; researchState?: { modelCalls?: number; totalTokens?: number } }
        | null;
      expect(planningCheckpoint?.version).toBe(2);
      expect(planningCheckpoint?.researchState?.modelCalls).toBeGreaterThan(0);
      expect(planningCheckpoint?.researchState?.totalTokens).toBeGreaterThan(0);

      await confirmResearchRunPlan(userId, created.id);
      const finished = await waitForRunStatus(
        created.id,
        ["completed", "failed", "awaiting_scope_confirmation"],
        300_000
      );

      expect(finished.status).toBe("completed");
      expect(finished.reportSnapshot?.contentHash).toMatch(/^[a-f0-9]{64}$/);
      const metrics = finished.metrics as {
        modelCalls?: number;
        totalTokens?: number;
        verificationSummary?: unknown;
      } | null;
      expect(metrics?.modelCalls).toBeGreaterThan(0);
      expect(metrics?.totalTokens).toBeGreaterThan(0);
      expect(metrics?.verificationSummary).toBeTruthy();
      console.log(JSON.stringify({
        status: finished.status,
        modelCalls: metrics?.modelCalls ?? 0,
        totalTokens: metrics?.totalTokens ?? 0,
        evidenceCount: (
          finished.reportSnapshot?.evidenceIds as string[] | undefined
        )?.length ?? 0,
        sourceCount: finished.reportSnapshot?.sourceSnapshotIds.length ?? 0,
        contentHash: finished.reportSnapshot?.contentHash ?? null,
      }));
    } finally {
      await (globalThis as WorkerGlobal).__lumenAgentExecutionWorker?.stop();
      await prisma.researchWorkspace
        .delete({ where: { id: workspace.id } })
        .catch(() => {});
      if (conversationId) {
        await prisma.conversation
          .delete({ where: { id: conversationId } })
          .catch(() => {});
      }
    }
  }, 420_000);
});
