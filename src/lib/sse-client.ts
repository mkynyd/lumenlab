/**
 * SSE (Server-Sent Events) parser for DeepSeek streaming responses.
 * Used on the client side to parse chat completion streams.
 */

export interface SSEChunk {
  content: string;
  reasoningContent: string;
  done: boolean;
}

export interface UsageInfo {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
}

export interface SSEParseResult {
  content: string;
  reasoningContent: string;
  usage: UsageInfo | null;
  done: boolean;
  conversationId?: string;
}

import type { AgentEvent } from "@/lib/agent/types";

export interface SSEAgentCallbacks {
  onAgentEvent?: (event: AgentEvent) => void;
  onEventId?: (sequence: number) => void;
}

export class SSEExecutionError extends Error {
  constructor(
    message: string,
    readonly status: "failed" | "cancelled",
    readonly failureCode: string | null
  ) {
    super(message);
    this.name = "SSEExecutionError";
  }
}

/**
 * Read an entire SSE stream and return the accumulated result.
 * @param reader from fetch response.body.getReader()
 * @param onChunk callback for each incremental chunk (for real-time UI updates)
 * @param options optional AgentEvent callback for `event: agent` lines
 */
export async function readSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onChunk: (chunk: SSEChunk) => void,
  options: SSEAgentCallbacks = {}
): Promise<SSEParseResult> {
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let pendingEventName: string | null = null;
  let usage: UsageInfo | null = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const rawLine of lines) {
        const line = rawLine.replace(/\r$/, "");
        if (line.startsWith("event: ")) {
          pendingEventName = line.slice(7).trim();
          continue;
        }
        if (line.startsWith("id: ")) {
          const sequence = Number(line.slice(4).trim());
          if (Number.isSafeInteger(sequence) && sequence > 0) {
            options.onEventId?.(sequence);
          }
          continue;
        }
        if (!line || !line.startsWith("data: ")) continue;

        const data = line.slice(6);
        if (pendingEventName === "agent") {
          pendingEventName = null;
          try {
            const parsed = JSON.parse(data) as AgentEvent;
            options.onAgentEvent?.(parsed);
          } catch {
            // ignore malformed agent events
          }
          continue;
        }
        if (pendingEventName === "execution_error") {
          pendingEventName = null;
          let payload: {
            status?: "failed" | "cancelled";
            failureCode?: string | null;
          } = {};
          try {
            payload = JSON.parse(data) as typeof payload;
          } catch {
            // Use the generic failure below.
          }
          const status = payload.status ?? "failed";
          throw new SSEExecutionError(
            status === "cancelled" ? "执行已取消" : "执行失败，请重试",
            status,
            payload.failureCode ?? null
          );
        }
        if (pendingEventName === "durable") {
          pendingEventName = null;
          continue;
        }
        pendingEventName = null;

        if (data === "[DONE]") {
          onChunk({ content: "", reasoningContent: "", done: true });
          return { content: "", reasoningContent: "", usage, done: true };
        }

        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta;

          if (json.usage) {
            usage = {
              promptTokens: json.usage.prompt_tokens ?? 0,
              completionTokens: json.usage.completion_tokens ?? 0,
              totalTokens: json.usage.total_tokens ?? 0,
              cacheHitTokens: json.usage.prompt_cache_hit_tokens ?? 0,
              cacheMissTokens: json.usage.prompt_cache_miss_tokens ?? 0,
            };
          }

          const chunk = {
            content: delta?.content || "",
            reasoningContent: delta?.reasoning_content || "",
            done: false,
          };
          onChunk(chunk);
        } catch {
          // skip malformed chunks
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  // If [DONE] was never received but stream ended
  return { content: "", reasoningContent: "", usage, done: false };
}
