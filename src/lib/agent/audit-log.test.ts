import { describe, expect, it } from "vitest";
import { sanitizeAuditPayload } from "./audit-log";

describe("sanitizeAuditPayload", () => {
  it("drops raw tool inputs, results, errors, credentials and unknown metric fields before audit persistence", () => {
    expect(
      sanitizeAuditPayload({
        eventType: "tool_completed",
        payload: {
          resultSummary: { content: "student material", token: "sk-secret" },
          arbitrary: "private",
        },
      })
    ).toEqual({ outcome: "succeeded" });

    expect(
      sanitizeAuditPayload({
        eventType: "agent_run_finished",
        payload: {
          runId: "run-1",
          status: "completed",
          success: true,
          provider: "deepseek",
          model: "deepseek-v4-pro",
          totalDurationMs: 100,
          firstTokenMs: 20,
          approvalWaitRatio: null,
          approvalsRequested: 0,
          approvalExecutionIds: ["execution-1"],
          autoRecoveryAttempted: false,
          autoRecoverySucceeded: false,
          retryCount: 0,
          cancelled: false,
          tool: { proposed: 0, succeeded: 0, failed: 0 },
          retrievalHit: false,
          retrievedSourceCount: 0,
          estimatedCredits: 1,
          prompt: "student material",
          token: "secret-token",
        },
      })
    ).toEqual(
      expect.objectContaining({
        runId: "run-1",
        approvalExecutionIds: ["execution-1"],
      })
    );
  });
});
