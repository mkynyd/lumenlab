/**
 * Diagnose why Research tool channels returned empty in the production smoke.
 * Read-only: runs each channel once and prints raw ToolRunner outcomes.
 * Usage: SMOKE_RUN_ID=<run> npx tsx scripts/research-channel-diag.ts
 */
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { createPrismaToolRunner } from "@/lib/agent/tools/tool-runner";

async function main() {
  const runId = process.env.SMOKE_RUN_ID?.trim();
  if (!runId) throw new Error("SMOKE_RUN_ID required");
  const run = await prisma.researchRun.findUniqueOrThrow({ where: { id: runId }, select: { id: true, userId: true, agentExecutionId: true } });
  const execution = run.agentExecutionId
    ? await prisma.agentExecution.findUnique({ where: { id: run.agentExecutionId }, select: { conversationId: true } })
    : null;
  const runner = createPrismaToolRunner();
  const base = {
    userId: run.userId,
    conversationId: execution?.conversationId ?? "diag",
    runId: run.id,
    agentExecutionId: run.agentExecutionId ?? undefined,
    skillId: "literature-review",
    signal: new AbortController().signal,
    sessionApprovals: new Map(),
  };
  for (const [toolId, args] of [
    ["web.search", { query: "mixture of experts routing 2025", maxResults: 3 }],
    ["arxiv.search", { query: "mixture of experts routing", maxResults: 3 }],
    ["sciverse.search", { query: "mixture of experts routing", pageSize: 3 }],
  ] as Array<[string, Record<string, unknown>]>) {
    console.log(`[diag] calling ${toolId}…`);
    const startedAt = Date.now();
    const result = await runner.run({ call: { id: randomUUID(), toolId, arguments: args }, context: base }, () => undefined);
    console.log(`[diag] ${toolId} returned in ${Date.now() - startedAt}ms`);
    if (result.status === "succeeded") {
      const summary = result.summary as Record<string, unknown>;
      console.log(`[diag] ${toolId}: succeeded, keys=${Object.keys(summary).join(",")}`);
    } else {
      console.log(`[diag] ${toolId}: ${result.status}`, "code" in result ? result.code : "", "error" in result ? String(result.error).slice(0, 300) : "");
    }
  }
}

main().catch((error) => {
  console.error("[diag] crashed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
