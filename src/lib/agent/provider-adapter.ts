/**
 * Provider adapters normalize DeepSeek, MiniMax, and future model streams
 * into a shared internal shape used by `/api/chat`.
 *
 * The adapter is intentionally thin: it only abstracts the call to the
 * provider and the extraction of tool calls / usage. History compression,
 * tool payload construction, and orchestration decisions stay in the route.
 */

import type { DeepSeekMessage } from "@/lib/deepseek";
import type { ToolUseBlock } from "@/lib/deepseek";
import type { ServerFileAttachment } from "@/lib/chat/router";

export interface AdapterUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
}

export interface AdapterStreamResult {
  stream: ReadableStream<Uint8Array>;
  getUsage: () => AdapterUsage | null;
  getToolCalls: () => ToolUseBlock[];
  /** Unsanitized raw assistant text for route-level XML/DSML fallback parsing. */
  getRawContent: () => string;
  /** Unsanitized raw reasoning text for route-level XML/DSML fallback parsing. */
  getRawReasoning: () => string;
}

export interface AdapterStreamParams {
  model: string;
  messages: DeepSeekMessage[];
  thinkingEnabled: boolean;
  reasoningEffort: "high" | "max";
  tools?: Array<{ type?: string; name: string; description?: string; input_schema?: Record<string, unknown>; [key: string]: unknown }>;
  attachments?: ServerFileAttachment[];
}

export interface ProviderAdapter {
  readonly provider: string;
  stream(params: AdapterStreamParams): Promise<AdapterStreamResult>;
}
