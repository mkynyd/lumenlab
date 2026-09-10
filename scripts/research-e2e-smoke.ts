/**
 * Deep Research Production Validation v1 — bounded E2E smoke (uncommitted ops script).
 *
 * Runs ONE quick-budget Research Run through the supported service entry points
 * (the same functions the API routes call) and an in-process durable worker with
 * proper leases — no backdoor routes, no auth bypass, no ad-hoc SQL writes.
 *
 * Usage (server build tree):
 *   SMOKE_USER_ID=<existing alpha user id> npx tsx scripts/research-e2e-smoke.ts
 *
 * Never prints secrets, hidden reasoning, or other users' data.
 */
import { prisma } from "@/lib/db";
import { startAgentExecutionWorker } from "@/lib/agent/executions/durable-agent-runtime";
import { confirmResearchRunPlan, createResearchRun, createResearchWorkspace } from "@/lib/research/service";

const QUESTION = "2025–2026 年大语言模型 Mixture-of-Experts 路由方法有哪些主要改进？请比较至少两个公开来源，并区分论文证据和网页资料。";
const TERMINAL = new Set(["completed", "failed", "cancelled"]);

function log(message: string, data?: Record<string, unknown>) {
  console.log(`[smoke] ${message}${data ? ` ${JSON.stringify(data)}` : ""}`);
}

async function waitForStatus(runId: string, wanted: (status: string) => boolean, timeoutMs: number, label: string) {
  const started = Date.now();
  let last = "";
  while (Date.now() - started < timeoutMs) {
    const run = await prisma.researchRun.findUnique({ where: { id: runId }, select: { status: true } });
    if (!run) throw new Error("run disappeared");
    if (run.status !== last) {
      log(`stage: ${last || "(created)"} -> ${run.status}`, { elapsedSec: Math.round((Date.now() - started) / 1000) });
      last = run.status;
    }
    if (wanted(run.status)) return run.status;
    if (TERMINAL.has(run.status)) return run.status;
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error(`timeout waiting for ${label}; last status=${last}`);
}

async function main() {
  const userId = process.env.SMOKE_USER_ID?.trim();
  if (!userId) throw new Error("SMOKE_USER_ID required");

  const worker = startAgentExecutionWorker();
  log("durable worker", worker);

  const workspace = await createResearchWorkspace({
    userId,
    name: `production-smoke-claim-graph-v1-${new Date().toISOString().slice(0, 16)}`,
    description: "Deep Research Production Validation v1 smoke workspace（明确标记的生产冒烟，可保留）",
    domainProfileKey: "computer_science",
    budgetProfile: "quick",
  });
  log("workspace created", { workspaceId: workspace.id });

  const run = await createResearchRun({ userId, workspaceId: workspace.id, question: QUESTION, budgetProfile: "quick" });
  log("run created", { runId: run.id });

  const planStatus = await waitForStatus(run.id, (status) => status === "awaiting_confirmation", 4 * 60_000, "plan");
  if (planStatus !== "awaiting_confirmation") throw new Error(`planning did not reach confirmation: ${planStatus}`);
  await confirmResearchRunPlan(userId, run.id);
  log("plan confirmed");

  const finalStatus = await waitForStatus(run.id, (status) => TERMINAL.has(status), 15 * 60_000, "terminal");
  const finalRun = await prisma.researchRun.findUniqueOrThrow({ where: { id: run.id }, select: { status: true, metrics: true } });
  const metrics = (finalRun.metrics ?? {}) as Record<string, unknown>;
  log("terminal", {
    status: finalStatus,
    modelCalls: metrics.modelCalls,
    totalTokens: metrics.totalTokens,
    costCredits: metrics.costCredits,
    evidenceCount: metrics.evidenceCount,
    claimCount: metrics.claimCount,
    sourceCount: metrics.sourceCount,
    verificationRepairs: metrics.verificationRepairs,
  });
  console.log(`SMOKE_RUN_ID=${run.id}`);
  console.log(`SMOKE_WORKSPACE_ID=${workspace.id}`);
  console.log(`SMOKE_FINAL_STATUS=${finalStatus}`);
  process.exit(finalStatus === "completed" ? 0 : 2);
}

main().catch((error) => {
  console.error("[smoke] failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
