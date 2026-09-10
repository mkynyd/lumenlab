/**
 * research-e2e-smoke — 正式的 Deep Research 有界 E2E 冒烟（live）。
 *
 * 通过项目受支持的服务入口（与 API 路由相同的 createResearchRun /
 * confirmResearchRunPlan）创建并执行一个 quick 预算 Research Run，
 * 进程内启动 durable worker 持正规 lease —— 不开后门路由、不绕过鉴权、
 * 不手工 SQL 伪造数据。
 *
 * 会真实调用模型与外部检索（有额度消耗），必须显式 opt-in：
 *   LUMENLAB_LIVE_SMOKE=1 SMOKE_USER_ID=<existing user id> \
 *     npx tsx --tsconfig scripts/tsconfig.json --env-file=.env scripts/research-e2e-smoke.ts
 *
 * 可选：SMOKE_QUESTION 覆盖默认研究问题。
 *
 * 运行环境注意：本脚本拉起完整 durable runtime（含 ESM-only 的 pi-ai 适配器），
 * 需要在 package.json 为 "type":"module" 的运行树执行（生产服务器 build 树即此形态）；
 * 本地开发树的等价 E2E 入口是
 * `RESEARCH_FULL_RUN_E2E=1 RESEARCH_E2E_USER_ID=<id> npm run test:research-run`。
 *
 * 永不打印 secret、隐藏 reasoning 或其他用户数据。Run 与 Workspace 名称带
 * production-smoke 标记，便于事后识别；默认保留在生产库中。
 */
import { prisma } from "@/lib/db";
import { startAgentExecutionWorker } from "@/lib/agent/executions/durable-agent-runtime";
import { confirmResearchRunPlan, createResearchRun, createResearchWorkspace } from "@/lib/research/service";
import { createDiagnosticsReporter, requireLiveSmoke } from "./lib/live-diagnostics";

const SCRIPT = "research-e2e-smoke";
const QUESTION = process.env.SMOKE_QUESTION?.trim()
  || "2025–2026 年大语言模型 Mixture-of-Experts 路由方法有哪些主要改进？请比较至少两个公开来源，并区分论文证据和网页资料。";
const TERMINAL = new Set(["completed", "failed", "cancelled"]);

async function waitForStatus(
  runId: string,
  wanted: (status: string) => boolean,
  timeoutMs: number,
  onTransition: (from: string, to: string, elapsedSec: number) => void,
): Promise<string> {
  const started = Date.now();
  let last = "";
  while (Date.now() - started < timeoutMs) {
    const run = await prisma.researchRun.findUnique({ where: { id: runId }, select: { status: true } });
    if (!run) throw new Error("run disappeared");
    if (run.status !== last) {
      onTransition(last || "(created)", run.status, Math.round((Date.now() - started) / 1000));
      last = run.status;
    }
    if (wanted(run.status)) return run.status;
    if (TERMINAL.has(run.status)) return run.status;
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error(`timeout waiting for status; last=${last}`);
}

async function main() {
  if (!requireLiveSmoke(SCRIPT, `SMOKE_USER_ID=<existing user id> npx tsx --tsconfig scripts/tsconfig.json --env-file=.env scripts/${SCRIPT}.ts`)) {
    process.exit(0);
  }
  const report = createDiagnosticsReporter(SCRIPT);
  const userId = process.env.SMOKE_USER_ID?.trim();
  if (!userId) {
    report.fail("SMOKE_USER_ID is required (existing account id; script never creates users)");
    process.exit(report.summarize());
  }

  const worker = startAgentExecutionWorker();
  report.info("durable worker started", worker);

  const workspace = await createResearchWorkspace({
    userId,
    name: `production-smoke-${new Date().toISOString().slice(0, 16)}`,
    description: "production smoke workspace（明确标记的生产冒烟，可保留）",
    domainProfileKey: "computer_science",
    budgetProfile: "quick",
  });
  report.info("workspace created", { workspaceId: workspace.id });

  const run = await createResearchRun({ userId, workspaceId: workspace.id, question: QUESTION, budgetProfile: "quick" });
  report.info("run created", { runId: run.id });

  const onTransition = (from: string, to: string, elapsedSec: number) =>
    report.info(`stage: ${from} -> ${to}`, { elapsedSec });

  const planStatus = await waitForStatus(run.id, (status) => status === "awaiting_confirmation", 4 * 60_000, onTransition);
  if (planStatus !== "awaiting_confirmation") {
    report.fail("planning did not reach awaiting_confirmation", { status: planStatus });
    process.exit(report.summarize());
  }
  report.pass("plan reached confirmation gate");
  await confirmResearchRunPlan(userId, run.id);

  const finalStatus = await waitForStatus(run.id, (status) => TERMINAL.has(status), 15 * 60_000, onTransition);
  const finalRun = await prisma.researchRun.findUniqueOrThrow({ where: { id: run.id }, select: { status: true, metrics: true } });
  const metrics = (finalRun.metrics ?? {}) as Record<string, unknown>;
  if (finalStatus === "completed") {
    report.pass("run completed", {
      modelCalls: metrics.modelCalls,
      totalTokens: metrics.totalTokens,
      costCredits: metrics.costCredits,
      evidenceCount: metrics.evidenceCount,
      claimCount: metrics.claimCount,
      sourceCount: metrics.sourceCount,
    });
  } else {
    report.fail("run did not complete", { status: finalStatus });
  }

  report.info(`SMOKE_RUN_ID=${run.id}`);
  report.info(`SMOKE_WORKSPACE_ID=${workspace.id}`);
  process.exit(report.summarize());
}

main().catch((error) => {
  console.error(`[${SCRIPT}] crashed:`, error instanceof Error ? error.message : String(error));
  process.exit(1);
});
