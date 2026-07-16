import type { ServerFileAttachment } from "@/lib/chat/router";
import type { ProjectType } from "@/lib/quick-actions";
import type { AgentSource } from "./sources";
import type { AgentRuntimeEvent } from "./runtime-events";
import type { AgentRuntimeMode } from "./runtime-mode";

export type ProviderName = "deepseek" | "minimax" | "bailian";
export type AgentModel =
  | "deepseek-v4-pro"
  | "deepseek-v4-flash"
  | "minimax-m3"
  | "qwen3.7-plus";
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
  };
  events: AsyncIterable<AgentRuntimeEvent>;
  completion: Promise<AgentCompletion>;
}

export interface AgentRuntime {
  run(input: AgentRunInput): Promise<AgentRun>;
}
