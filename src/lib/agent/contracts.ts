import type { ServerFileAttachment } from "@/lib/chat/router";
import type { DeepSeekMessage } from "@/lib/deepseek";
import type { CatalogModelId } from "@/lib/chat/model-catalog";
import type { ProjectType } from "@/lib/quick-actions";
import type { AgentSource } from "./sources";
import type { AgentRuntimeEvent } from "./runtime-events";
import type { AgentRuntimeMode } from "./runtime-mode";

export type ProviderName = "deepseek" | "minimax" | "bailian";
/**
 * 目录已知的全部模型 ID（活跃 + 历史别名）。
 * 新请求在 sendMessageSchema 层已限定为活跃模型；历史别名保留给
 * 存量 durable checkpoint 恢复与历史记录展示。
 */
export type AgentModel = CatalogModelId;
export type MaterialScope = "project-corpus" | "none";

export interface AgentRunInput {
  user: { id: string };
  conversation: {
    id?: string;
    projectId?: string;
  };
  prompt: {
    message: string;
    hiddenPrompt?: string;
    attachments: ServerFileAttachment[];
  };
  model: {
    requestedModel: AgentModel;
    thinkingEnabled: boolean;
    reasoningEffort: "high" | "max";
  };
  capabilities: {
    webSearchActive: boolean;
    manualSkillId?: string;
    skillOff: boolean;
    selectedFileIds: string[];
    mode?: ProjectType;
    isQuickTask: boolean;
    materialScope?: MaterialScope;
  };
  durable?: {
    executionId: string;
    userMessageId: string;
    assistantMessageId: string;
    priorUsage?: AgentUsage;
    /** Structured current-turn transcript restored from Checkpoint v2. */
    continuationMessages?: DeepSeekMessage[];
    /** Recovery-only guard for tool calls whose outcomes are already durable. */
    completedToolCalls?: Array<{
      toolId: string;
      arguments: Record<string, unknown>;
    }>;
  };
  signal: AbortSignal;
}

export interface AgentUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  promptCacheHitTokens?: number;
  promptCacheMissTokens?: number;
}

export interface AgentCompletion {
  status: "completed" | "awaiting_approval" | "cancelled";
  conversationId: string;
  messageId: string;
  provider: ProviderName;
  model: AgentModel;
  usage: AgentUsage | null;
  sources: AgentSource[];
}

export interface AgentRun {
  /** Available before streaming so the HTTP adapter can preserve response headers. */
  metadata: {
    conversationId: string;
    messageId: string;
    provider: ProviderName;
    model: AgentModel;
    runtimeMode: AgentRuntimeMode;
    runtimeVersion: string;
    toolProtocol: "native" | "native+xml_dsml" | "none";
    agentExecutionId?: string;
  };
  events: AsyncIterable<AgentRuntimeEvent>;
  completion: Promise<AgentCompletion>;
}

export interface AgentRuntime {
  run(input: AgentRunInput): Promise<AgentRun>;
}
