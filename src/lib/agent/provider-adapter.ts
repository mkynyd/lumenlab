/**
 * Provider adapters normalize DeepSeek, MiniMax, and future model streams
 * into a shared internal shape used by Agent Runtime.
 *
 * Provider-specific tool names, native blocks, XML/DSML fallback parsing, and
 * continuation transcript construction stop at this boundary. Runtime only
 * receives normalized calls and provider-neutral round operations.
 */

import type { DeepSeekMessage } from "@/lib/deepseek";
import type { ServerFileAttachment } from "@/lib/chat/router";
import type { ToolMetadata } from "@/lib/agent/types";
import type { ProviderName } from "@/lib/agent/contracts";
import {
  normalizeProviderEventStream,
  type ProviderStreamEvent,
} from "@/lib/agent/providers/provider-event-stream";

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
  getToolCalls: () => ProviderNativeToolCall[];
  /** Unsanitized raw assistant text for adapter-owned fallback parsing. */
  getRawContent: () => string;
  /** Unsanitized raw reasoning text for adapter-owned fallback parsing. */
  getRawReasoning: () => string;
}

export interface AdapterStreamParams {
  model: string;
  messages: DeepSeekMessage[];
  thinkingEnabled: boolean;
  reasoningEffort: "high" | "max";
  signal?: AbortSignal;
  tools?: Array<{ type?: string; name: string; description?: string; input_schema?: Record<string, unknown>; [key: string]: unknown }>;
  attachments?: ServerFileAttachment[];
}

export type ToolCallProtocol = "native" | "xml_dsml";

export interface ProviderNativeToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface NormalizedToolCall extends ProviderNativeToolCall {
  source: ToolCallProtocol;
}

export interface ProviderRound
  extends Omit<AdapterStreamResult, "stream" | "getToolCalls"> {
  /** Exact normalized transcript sent for this round; opaque to HTTP adapters. */
  requestMessages: DeepSeekMessage[];
  /** Provider-neutral stream consumed by Agent Runtime and persistence. */
  events: ReadableStream<ProviderStreamEvent>;
  getToolCalls: () => NormalizedToolCall[];
}

export interface ProviderRoundInput
  extends Omit<AdapterStreamParams, "tools"> {
  activeTools: ToolMetadata[];
}

export interface ProviderToolResult {
  toolUseId: string;
  content: string;
}

export interface ProviderContinuationInput extends ProviderRoundInput {
  toolCalls: NormalizedToolCall[];
  toolResults: ProviderToolResult[];
  rawContent: string;
  stopInstruction?: string;
}

export type ProviderToolProtocol = "native" | "native+xml_dsml" | "none";

export interface ProviderAdapter {
  readonly provider: ProviderName;
  stream(params: AdapterStreamParams): Promise<AdapterStreamResult>;
  toolProtocol(activeTools: ToolMetadata[]): ProviderToolProtocol;
  startRound(params: ProviderRoundInput): Promise<ProviderRound>;
  continueRound(params: ProviderContinuationInput): Promise<ProviderRound>;
}

export function createProviderRound(
  result: AdapterStreamResult,
  normalizeNativeName: (name: string) => string,
  requestMessages: DeepSeekMessage[],
  fallbackToolCalls: () => NormalizedToolCall[] = () => []
): ProviderRound {
  return {
    events: normalizeProviderEventStream(result.stream),
    requestMessages,
    getUsage: result.getUsage,
    getRawContent: result.getRawContent,
    getRawReasoning: result.getRawReasoning,
    getToolCalls: () => {
      const nativeCalls: NormalizedToolCall[] = result.getToolCalls().map((call) => ({
        ...call,
        name: normalizeNativeName(call.name),
        source: "native",
      }));
      const seen = new Set<string>();
      return [...nativeCalls, ...fallbackToolCalls()].filter((call) => {
        const key = `${call.name}:${stableStringify(call.input)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    },
  };
}

export function formatFallbackToolInstructions(tools: ToolMetadata[]): string {
  if (tools.length === 0) return "";
  const exampleTool = tools.find((tool) => tool.toolId !== "skill.activate") ?? tools[0];
  const exampleSchema = exampleTool.inputSchema as {
    required?: string[];
  };
  const exampleRequired = exampleSchema.required?.[0];
  const exampleParameter = exampleRequired
    ? `    <parameter name="${exampleRequired}">值</parameter>\n`
    : "";
  const lines = [
    "你可以调用以下工具获取信息或执行操作。需要调用时，请严格使用如下 XML 格式（可包含多个 invoke）：",
    "",
    "<tool_calls>",
    `  <invoke name="${exampleTool.toolId}">`,
    exampleParameter,
    "  </invoke>",
    "</tool_calls>",
    "",
    "可用工具：",
  ];
  for (const tool of tools) {
    const schema = tool.inputSchema as { required?: string[] };
    const required = schema.required?.length
      ? `（必填：${schema.required.join(", ")}）`
      : "";
    lines.push(`- ${tool.toolId}: ${tool.description}${required}`);
  }
  return lines.join("\n");
}

export function appendSystemInstructions(
  messages: DeepSeekMessage[],
  instructions: string
): DeepSeekMessage[] {
  if (!instructions) return messages;
  if (
    messages.some(
      (message) =>
        message.role === "system" &&
        typeof message.content === "string" &&
        message.content.includes(instructions)
    )
  ) {
    return messages;
  }
  let injected = false;
  const next = messages.map((message) => {
    if (!injected && message.role === "system" && typeof message.content === "string") {
      injected = true;
      return { ...message, content: `${message.content}\n\n${instructions}` };
    }
    return message;
  });
  return injected
    ? next
    : [{ role: "system", content: instructions }, ...next];
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
