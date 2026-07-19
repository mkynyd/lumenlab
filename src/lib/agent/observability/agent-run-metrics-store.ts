import { prisma } from "@/lib/db";
import type { AgentRunMetrics } from "./agent-run-metrics";

export interface AgentRunMetricRow {
  createdAt: Date;
  payload: unknown;
}

export interface AgentRunMetricsSummary {
  runCount: number;
  /** Runs paused for user approval are intentionally excluded from success quality. */
  pendingRunCount: number;
  successRate: number;
  averageApprovalWaitRatio: number | null;
  autoRecoverySuccessRate: number;
  averageFirstTokenMs: number | null;
  averageTotalDurationMs: number;
  retryRate: number;
  cancellationRate: number;
  toolSuccessRate: number;
  retrievalHitRate: number;
  averageCredits: number;
}

export interface AgentRunMetricView extends AgentRunMetrics {
  createdAt: string;
}

/** Converts stored JSON to the allowlisted metrics contract, dropping unknown fields. */
export function readAgentRunMetricRow(row: AgentRunMetricRow): AgentRunMetricView | null {
  const payload = row.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const input = payload as Record<string, unknown>;
  if (
    typeof input.runId !== "string" ||
    !isStatus(input.status) ||
    !isProvider(input.provider) ||
    typeof input.model !== "string" ||
    typeof input.success !== "boolean" ||
    !isNonNegativeNumber(input.totalDurationMs) ||
    !(input.firstTokenMs === null || isNonNegativeNumber(input.firstTokenMs)) ||
    !(input.approvalWaitRatio === null || isUnitNumber(input.approvalWaitRatio)) ||
    !isNonNegativeNumber(input.approvalsRequested) ||
    !isStringList(input.approvalExecutionIds) ||
    typeof input.autoRecoveryAttempted !== "boolean" ||
    typeof input.autoRecoverySucceeded !== "boolean" ||
    !isNonNegativeNumber(input.retryCount) ||
    typeof input.cancelled !== "boolean" ||
    typeof input.retrievalHit !== "boolean" ||
    !isNonNegativeNumber(input.retrievedSourceCount) ||
    !isNonNegativeNumber(input.estimatedCredits) ||
    !isToolSummary(input.tool)
  ) {
    return null;
  }
  return {
    runId: input.runId,
    status: input.status,
    success: input.success,
    provider: input.provider,
    model: input.model,
    totalDurationMs: input.totalDurationMs,
    firstTokenMs: input.firstTokenMs,
    approvalWaitRatio: input.approvalWaitRatio,
    approvalsRequested: input.approvalsRequested,
    approvalExecutionIds: input.approvalExecutionIds,
    autoRecoveryAttempted: input.autoRecoveryAttempted,
    autoRecoverySucceeded: input.autoRecoverySucceeded,
    retryCount: input.retryCount,
    cancelled: input.cancelled,
    tool: input.tool,
    retrievalHit: input.retrievalHit,
    retrievedSourceCount: input.retrievedSourceCount,
    estimatedCredits: input.estimatedCredits,
    createdAt: row.createdAt.toISOString(),
  };
}

export function summarizeAgentRunMetrics(runs: readonly AgentRunMetricView[]): AgentRunMetricsSummary {
  const count = runs.length;
  const average = (values: number[]) =>
    values.length === 0 ? 0 : round(values.reduce((sum, value) => sum + value, 0) / values.length);
  const toolAttempts = runs.reduce(
    (sum, run) => sum + run.tool.succeeded + run.tool.failed,
    0
  );
  const recoveryAttempts = runs.filter((run) => run.autoRecoveryAttempted);
  const firstTokens = runs
    .map((run) => run.firstTokenMs)
    .filter((value): value is number => value !== null);
  const approvalWaitRatios = runs
    .map((run) => run.approvalWaitRatio)
    .filter((value): value is number => value !== null);
  const qualityRuns = runs.filter(
    (run) => run.status === "completed" || run.status === "failed"
  );
  return {
    runCount: count,
    pendingRunCount: runs.filter((run) => run.status === "awaiting_approval").length,
    successRate: rate(
      qualityRuns.filter((run) => run.status === "completed").length,
      qualityRuns.length
    ),
    averageApprovalWaitRatio: approvalWaitRatios.length ? average(approvalWaitRatios) : null,
    autoRecoverySuccessRate: rate(
      recoveryAttempts.filter((run) => run.autoRecoverySucceeded).length,
      recoveryAttempts.length
    ),
    averageFirstTokenMs: firstTokens.length ? average(firstTokens) : null,
    averageTotalDurationMs: average(runs.map((run) => run.totalDurationMs)),
    retryRate: rate(runs.filter((run) => run.retryCount > 0).length, count),
    cancellationRate: rate(runs.filter((run) => run.cancelled).length, count),
    toolSuccessRate: rate(
      runs.reduce((sum, run) => sum + run.tool.succeeded, 0),
      toolAttempts
    ),
    retrievalHitRate: rate(runs.filter((run) => run.retrievalHit).length, count),
    averageCredits: average(runs.map((run) => run.estimatedCredits)),
  };
}

export async function getAgentRunMetrics(userId: string, days = 7) {
  const safeDays = Math.min(90, Math.max(1, Math.floor(days)));
  const since = new Date(Date.now() - safeDays * 86_400_000);
  const rows = await prisma.agentAuditLog.findMany({
    where: {
      userId,
      eventType: "agent_run_finished",
      createdAt: { gte: since },
    },
    select: { createdAt: true, payload: true },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  const storedRuns = rows
    .map(readAgentRunMetricRow)
    .filter((row): row is AgentRunMetricView => Boolean(row));
  const toolExecutions = await prisma.toolExecution.findMany({
    where: { userId, createdAt: { gte: since } },
    select: {
      id: true,
      createdAt: true,
      approvedAt: true,
      completedAt: true,
      status: true,
      auditMetadata: true,
    },
    take: 500,
  });
  const approvalIdsByRunId = new Map(
    storedRuns.map((run) => [run.runId, new Set(run.approvalExecutionIds)])
  );
  const approvalWaitMsByRunId = new Map<string, number>();
  for (const execution of toolExecutions) {
    const runId = runIdFromExecutionMetadata(execution.auditMetadata);
    if (!runId || !approvalIdsByRunId.get(runId)?.has(execution.id)) continue;
    const end = execution.approvedAt ?? execution.completedAt ?? new Date();
    const waitMs = Math.max(0, end.getTime() - execution.createdAt.getTime());
    approvalWaitMsByRunId.set(
      runId,
      (approvalWaitMsByRunId.get(runId) ?? 0) + waitMs
    );
  }
  const runs = storedRuns.map((run) => {
    if (run.approvalsRequested === 0) return { ...run, approvalWaitRatio: 0 };
    const waitMs = approvalWaitMsByRunId.get(run.runId);
    if (waitMs === undefined) return run;
    return {
      ...run,
      approvalWaitRatio: round(waitMs / Math.max(run.totalDurationMs + waitMs, 1)),
    };
  });
  return { days: safeDays, summary: summarizeAgentRunMetrics(runs), runs };
}

function isStatus(value: unknown): value is AgentRunMetrics["status"] {
  return value === "completed" || value === "awaiting_approval" || value === "cancelled" || value === "failed";
}

function isProvider(value: unknown): value is AgentRunMetrics["provider"] {
  return value === "deepseek" || value === "minimax" || value === "bailian";
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isUnitNumber(value: unknown): value is number {
  return isNonNegativeNumber(value) && value <= 1;
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isToolSummary(value: unknown): value is AgentRunMetrics["tool"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const tool = value as Record<string, unknown>;
  return isNonNegativeNumber(tool.proposed) && isNonNegativeNumber(tool.succeeded) && isNonNegativeNumber(tool.failed);
}

function rate(numerator: number, denominator: number) {
  return denominator === 0 ? 0 : round(numerator / denominator);
}

function round(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

function runIdFromExecutionMetadata(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const metadata = value as Record<string, unknown>;
  const executionContext = metadata.executionContext;
  if (!executionContext || typeof executionContext !== "object" || Array.isArray(executionContext)) {
    return null;
  }
  const runId = (executionContext as Record<string, unknown>).runId;
  return typeof runId === "string" ? runId : null;
}
