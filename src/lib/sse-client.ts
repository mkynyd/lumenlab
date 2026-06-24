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
  conversationId?: string;
}

import type { AgentEvent } from "@/lib/agent/types";

export interface SSEAgentCallbacks {
  onAgentEvent?: (event: AgentEvent) => void;
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
        pendingEventName = null;

        if (data === "[DONE]") {
          onChunk({ content: "", reasoningContent: "", done: true });
          return { content: "", reasoningContent: "", usage };
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
  return { content: "", reasoningContent: "", usage };
}
