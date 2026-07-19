import { describe, expect, it } from "vitest";
import { AgentRunMetricsCollector } from "./agent-run-metrics";

describe("AgentRunMetricsCollector", () => {
  it("records the P1 operational metrics without retaining prompt or source content", () => {
    const collector = new AgentRunMetricsCollector({
      runId: "run-test-1",
      model: "deepseek-v4-pro",
      provider: "deepseek",
      startedAt: 1_000,
    });
    collector.observeAgentEvent({
      type: "sources_updated",
      sources: [{ type: "project_file", title: "private course material", fileId: "file-private" }],
    }, 1_010);
    collector.observeAgentEvent({
      type: "approval_required",
      executionId: "execution-1",
      preview: {
        toolId: "artifact.save",
        toolName: "保存成果",
        summary: "private title",
        affectedResources: [],
        sendsToExternal: false,
        isReversible: true,
        dataTypes: [],
      },
      token: "secret-token",
      expiresAt: 2_000,
      canApproveSession: true,
    }, 1_020);
    collector.observeAgentEvent({
      type: "tool_proposed",
      executionId: "execution-2",
      preview: {
        toolId: "web.fetch",
        toolName: "抓取网页",
        summary: "private URL",
        affectedResources: [],
        sendsToExternal: true,
        isReversible: true,
        dataTypes: [],
      },
    }, 1_025);
    collector.observeAgentEvent({
      type: "tool_failed",
      executionId: "execution-2",
      errorCode: "TIMEOUT",
      error: "private endpoint failed",
    }, 1_030);
    collector.observeAgentEvent({
      type: "tool_proposed",
      executionId: "execution-3",
      preview: {
        toolId: "web.fetch",
        toolName: "联网检索",
        summary: "private query",
        affectedResources: [],
        sendsToExternal: true,
        isReversible: true,
        dataTypes: [],
      },
    }, 1_040);
    collector.observeAgentEvent({
      type: "tool_completed",
      executionId: "execution-3",
      resultSummary: { url: "https://example.test/private" },
    }, 1_050);
    collector.observeAgentEvent({
      type: "tool_recovery_attempted",
      failedExecutionId: "execution-2",
      recoveryExecutionId: "execution-3",
    }, 1_055);
    collector.observeProviderEvent({ type: "text_delta", text: "answer" }, 1_060);
    collector.observeProviderEvent({
      type: "usage",
      usage: { prompt_tokens: 1_000, completion_tokens: 100, total_tokens: 1_100 },
    }, 1_090);

    const metrics = collector.finish("completed", 1_100);

    expect(metrics).toMatchObject({
      status: "completed",
      totalDurationMs: 100,
      firstTokenMs: 60,
      approvalWaitRatio: null,
      autoRecoverySucceeded: true,
      retryCount: 1,
      retrievalHit: true,
      retrievedSourceCount: 1,
      tool: { succeeded: 1, failed: 1 },
    });
    expect(metrics.estimatedCredits).toBeGreaterThan(0);
    expect(JSON.stringify(metrics)).not.toContain("private");
    expect(JSON.stringify(metrics)).not.toContain("secret-token");
  });

  it("does not call an unrelated later tool an automatic recovery or retry", () => {
    const collector = new AgentRunMetricsCollector({
      runId: "run-test-2",
      model: "deepseek-v4-pro",
      provider: "deepseek",
      startedAt: 1,
    });
    collector.observeAgentEvent(proposed("failed-fetch", "web.fetch"));
    collector.observeAgentEvent({
      type: "tool_failed",
      executionId: "failed-fetch",
      errorCode: "TIMEOUT",
      error: "timeout",
    });
    collector.observeAgentEvent(proposed("next-search", "web.search"));
    collector.observeAgentEvent({
      type: "tool_completed",
      executionId: "next-search",
      resultSummary: {},
    });

    expect(collector.finish("completed", 10)).toMatchObject({
      autoRecoveryAttempted: false,
      autoRecoverySucceeded: false,
      retryCount: 0,
    });
  });
});

function proposed(executionId: string, toolId: string) {
  return {
    type: "tool_proposed" as const,
    executionId,
    preview: {
      toolId,
      toolName: toolId,
      summary: toolId,
      affectedResources: [],
      sendsToExternal: false,
      isReversible: true,
      dataTypes: [],
    },
  };
}
