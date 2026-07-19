import { describe, expect, it } from "vitest";
import {
  readAgentRunMetricRow,
  summarizeAgentRunMetrics,
} from "./agent-run-metrics-store";

describe("agent run metrics store", () => {
  it("allowlists persisted metric fields and aggregates the P1 monitoring view", () => {
    const run = readAgentRunMetricRow({
      createdAt: new Date("2026-07-19T00:00:00.000Z"),
      payload: {
        runId: "run-1",
        status: "completed",
        success: true,
        provider: "deepseek",
        model: "deepseek-v4-pro",
        totalDurationMs: 200,
        firstTokenMs: 50,
        approvalWaitRatio: null,
        approvalsRequested: 0,
        approvalExecutionIds: [],
        autoRecoveryAttempted: true,
        autoRecoverySucceeded: true,
        retryCount: 1,
        cancelled: false,
        tool: { proposed: 2, succeeded: 2, failed: 1 },
        retrievalHit: true,
        retrievedSourceCount: 3,
        estimatedCredits: 8,
        prompt: "must not be returned",
      },
    });

    expect(run).not.toHaveProperty("prompt");
    expect(run).toMatchObject({ status: "completed", createdAt: "2026-07-19T00:00:00.000Z" });
    expect(summarizeAgentRunMetrics([run!])).toMatchObject({
      runCount: 1,
      successRate: 1,
      autoRecoverySuccessRate: 1,
      toolSuccessRate: 0.6667,
      retrievalHitRate: 1,
      averageCredits: 8,
    });
  });

  it("does not treat an approval-pending run as a failed answer", () => {
    const completed = readAgentRunMetricRow({
      createdAt: new Date(),
      payload: basePayload({ runId: "completed", status: "completed", success: true }),
    })!;
    const waiting = readAgentRunMetricRow({
      createdAt: new Date(),
      payload: basePayload({
        runId: "waiting",
        status: "awaiting_approval",
        success: false,
        approvalsRequested: 1,
        approvalExecutionIds: ["execution-1"],
      }),
    })!;

    expect(summarizeAgentRunMetrics([completed, waiting])).toMatchObject({
      runCount: 2,
      pendingRunCount: 1,
      successRate: 1,
    });
  });
});

function basePayload(overrides: Record<string, unknown>) {
  return {
    runId: "run-default",
    status: "completed",
    success: true,
    provider: "deepseek",
    model: "deepseek-v4-pro",
    totalDurationMs: 100,
    firstTokenMs: 20,
    approvalWaitRatio: null,
    approvalsRequested: 0,
    approvalExecutionIds: [],
    autoRecoveryAttempted: false,
    autoRecoverySucceeded: false,
    retryCount: 0,
    cancelled: false,
    tool: { proposed: 0, succeeded: 0, failed: 0 },
    retrievalHit: false,
    retrievedSourceCount: 0,
    estimatedCredits: 0,
    ...overrides,
  };
}
