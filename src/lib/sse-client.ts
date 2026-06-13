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

/**
 * Read an entire SSE stream and return the accumulated result.
 * @param reader from fetch response.body.getReader()
 * @param onChunk callback for each incremental chunk (for real-time UI updates)
 */
export async function readSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onChunk: (chunk: SSEChunk) => void
): Promise<SSEParseResult> {
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let usage: UsageInfo | null = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;

        const data = trimmed.slice(6);
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
