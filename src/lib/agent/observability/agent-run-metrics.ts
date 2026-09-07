import type { AgentCompletion, AgentUsage } from "../contracts";
import type { ProviderStreamEvent } from "../providers/provider-event-stream";
import type { AgentEvent } from "../types";
import { calculateCredits, UnknownModelCreditError } from "@/lib/tokens";

export interface AgentRunMetrics {
  runId: string;
  status: AgentCompletion["status"] | "failed";
  success: boolean;
  provider: "deepseek" | "minimax" | "bailian";
  model: string;
  totalDurationMs: number;
  firstTokenMs: number | null;
  /** Filled from the ToolExecution lifecycle by the authenticated metrics read model. */
  approvalWaitRatio: number | null;
  approvalsRequested: number;
  approvalExecutionIds: string[];
  autoRecoveryAttempted: boolean;
  autoRecoverySucceeded: boolean;
  retryCount: number;
  cancelled: boolean;
  tool: { proposed: number; succeeded: number; failed: number };
  retrievalHit: boolean;
  retrievedSourceCount: number;
  estimatedCredits: number;
}

/**
 * Records timing and aggregate counters only. Prompt text, source titles,
 * URLs, result payloads, approval tokens and error text are intentionally
 * never copied into the metrics payload.
 */
export class AgentRunMetricsCollector {
  private readonly startedAt: number;
  private model: string;
  private provider: "deepseek" | "minimax" | "bailian";
  private firstTokenAt: number | null = null;
  private approvalsRequested = 0;
  private readonly approvalExecutionIds = new Set<string>();
  private toolProposed = 0;
  private toolSucceeded = 0;
  private toolFailed = 0;
  private retryCount = 0;
  private readonly toolIdsByExecution = new Map<string, string>();
  private readonly completedExecutionIds = new Set<string>();
  private readonly recoveryExecutionIds = new Set<string>();
  private autoRecoveryAttempted = false;
  private autoRecoverySucceeded = false;
  private retrievedSourceCount = 0;
  private usage: AgentUsage | null = null;

  constructor(
    private readonly identity: {
      runId: string;
      model: string;
      provider: "deepseek" | "minimax" | "bailian";
      startedAt?: number;
    }
  ) {
    this.startedAt = identity.startedAt ?? Date.now();
    this.model = identity.model;
    this.provider = identity.provider;
  }

  setRoute(input: { model: string; provider: "deepseek" | "minimax" | "bailian" }) {
    this.model = input.model;
    this.provider = input.provider;
  }

  observeAgentEvent(event: AgentEvent, observedAt = Date.now()) {
    void observedAt;
    switch (event.type) {
      case "sources_updated":
        this.retrievedSourceCount = Math.max(
          this.retrievedSourceCount,
          event.sources.length
        );
        break;
      case "approval_required":
        this.approvalsRequested += 1;
        this.approvalExecutionIds.add(event.executionId);
        break;
      case "tool_proposed":
        this.toolProposed += 1;
        this.toolIdsByExecution.set(event.executionId, event.preview.toolId);
        break;
      case "tool_failed": {
        this.toolFailed += 1;
        break;
      }
      case "tool_completed": {
        this.toolSucceeded += 1;
        this.completedExecutionIds.add(event.executionId);
        if (this.recoveryExecutionIds.has(event.executionId)) {
          this.autoRecoverySucceeded = true;
        }
        break;
      }
      case "tool_recovery_attempted":
        this.autoRecoveryAttempted = true;
        this.retryCount += 1;
        this.recoveryExecutionIds.add(event.recoveryExecutionId);
        if (this.completedExecutionIds.has(event.recoveryExecutionId)) {
          this.autoRecoverySucceeded = true;
        }
        break;
    }
  }

  observeProviderEvent(event: ProviderStreamEvent, observedAt = Date.now()) {
    if (event.type === "text_delta" && event.text && this.firstTokenAt === null) {
      this.firstTokenAt = observedAt;
    }
    if (event.type === "usage") {
      this.usage = normalizeUsage(event.usage);
    }
  }

  recordUsage(usage: AgentUsage | null) {
    if (usage) this.usage = usage;
  }

  finish(
    status: AgentCompletion["status"] | "failed",
    finishedAt = Date.now()
  ): AgentRunMetrics {
    const totalDurationMs = Math.max(0, finishedAt - this.startedAt);
    const usage = this.usage;
    return {
      runId: this.identity.runId,
      status,
      success: status === "completed",
      provider: this.provider,
      model: this.model,
      totalDurationMs,
      firstTokenMs:
        this.firstTokenAt === null
          ? null
          : Math.max(0, this.firstTokenAt - this.startedAt),
      approvalWaitRatio: null,
      approvalsRequested: this.approvalsRequested,
      approvalExecutionIds: [...this.approvalExecutionIds],
      autoRecoveryAttempted: this.autoRecoveryAttempted,
      autoRecoverySucceeded: this.autoRecoverySucceeded,
      retryCount: this.retryCount,
      cancelled: status === "cancelled",
      tool: {
        proposed: this.toolProposed,
        succeeded: this.toolSucceeded,
        failed: this.toolFailed,
      },
      retrievalHit: this.retrievedSourceCount > 0,
      retrievedSourceCount: this.retrievedSourceCount,
      estimatedCredits: usage ? estimateCredits(this.model, usage, this.startedAt) : 0,
    };
  }
}

/**
 * 指标里的信用点只是观测估算，不是结算路径：
 * 未知模型按 0 记录而不是抛出，避免审计写入把已完成的运行打成失败。
 * 峰谷档按 run 开始时间冻结。
 */
function estimateCredits(
  model: string,
  usage: AgentUsage,
  startedAt: number
): number {
  try {
    return calculateCredits(
      model,
      {
        inputCacheHitTokens: usage.promptCacheHitTokens ?? 0,
        inputCacheMissTokens:
          usage.promptCacheMissTokens ??
          Math.max(usage.promptTokens - (usage.promptCacheHitTokens ?? 0), 0),
        outputTokens: usage.completionTokens,
      },
      { requestStartedAt: new Date(startedAt) }
    );
  } catch (error) {
    if (error instanceof UnknownModelCreditError) return 0;
    throw error;
  }
}

function normalizeUsage(usage: {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
}): AgentUsage {
  return {
    promptTokens: usage.prompt_tokens ?? 0,
    completionTokens: usage.completion_tokens ?? 0,
    totalTokens: usage.total_tokens ?? 0,
    promptCacheHitTokens: usage.prompt_cache_hit_tokens,
    promptCacheMissTokens: usage.prompt_cache_miss_tokens,
  };
}
