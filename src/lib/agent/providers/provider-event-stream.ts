import type { AdapterUsage } from "../provider-adapter";
import type { ProviderRound } from "../provider-adapter";
import type { DeepSeekMessage } from "@/lib/deepseek";

export type ProviderStreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "reasoning_delta"; text: string }
  | { type: "usage"; usage: AdapterUsage };

/**
 * Normalize the internal transport emitted by current provider clients.
 * Runtime and persistence consume these events and never inspect provider SSE
 * payloads or OpenAI-compatible `choices` fields.
 */
export function normalizeProviderEventStream(
  stream: ReadableStream<Uint8Array>
): ReadableStream<ProviderStreamEvent> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  return new ReadableStream<ProviderStreamEvent>({
    async start(controller) {
      reader = stream.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          buffer += decoder.decode(next.value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            enqueueLine(line, controller);
          }
        }
        buffer += decoder.decode();
        if (buffer) enqueueLine(buffer, controller);
        controller.close();
      } catch (error) {
        controller.error(error);
      } finally {
        reader.releaseLock();
      }
    },
    async cancel(reason) {
      await reader?.cancel(reason).catch(() => {});
    },
  });
}

export function createTextProviderRound(
  requestMessages: DeepSeekMessage[],
  content: string
): ProviderRound {
  return {
    requestMessages,
    events: new ReadableStream<ProviderStreamEvent>({
      start(controller) {
        if (content) controller.enqueue({ type: "text_delta", text: content });
        controller.close();
      },
    }),
    getUsage: () => null,
    getToolCalls: () => [],
    getRawContent: () => content,
    getRawReasoning: () => "",
  };
}

function enqueueLine(
  rawLine: string,
  controller: ReadableStreamDefaultController<ProviderStreamEvent>
) {
  const line = rawLine.trim();
  if (!line.startsWith("data: ")) return;
  const data = line.slice(6);
  if (!data || data === "[DONE]") return;
  try {
    const payload = JSON.parse(data) as {
      usage?: AdapterUsage;
      choices?: Array<{
        delta?: { content?: string; reasoning_content?: string };
      }>;
    };
    const delta = payload.choices?.[0]?.delta;
    if (delta?.reasoning_content) {
      controller.enqueue({
        type: "reasoning_delta",
        text: delta.reasoning_content,
      });
    }
    if (delta?.content) {
      controller.enqueue({ type: "text_delta", text: delta.content });
    }
    if (payload.usage) {
      controller.enqueue({ type: "usage", usage: payload.usage });
    }
  } catch {
    // Provider transport errors surface through the stream itself. A malformed
    // leftover line is ignored to preserve the historical SSE tolerance.
  }
}
