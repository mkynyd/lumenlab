import { formatAgentEvent } from "@/lib/agent/event-stream";
import type { AgentRun } from "@/lib/agent/contracts";
import type { AgentEvent } from "@/lib/agent/types";

const encoder = new TextEncoder();

function encodeData(payload: unknown) {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

/**
 * Adapt runtime-native events to the existing chat SSE contract.
 *
 * Runtime code deliberately knows nothing about HTTP or SSE. This adapter is
 * the only place that translates model deltas back into the OpenAI-compatible
 * chunks consumed by useChat while preserving the existing AgentEvent stream.
 */
export function createChatResponse(run: AgentRun): Response {
  const iterator = run.events[Symbol.asyncIterator]();
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      void (async () => {
        try {
          while (!cancelled) {
            const next = await iterator.next();
            if (next.done) break;
            const event = next.value;
            switch (event.type) {
              case "model_started":
                // The existing model_adapter_selected AgentEvent carries this
                // information for clients without expanding their event union.
                break;
              case "text_delta":
                controller.enqueue(
                  encodeData({ choices: [{ delta: { content: event.text } }] })
                );
                break;
              case "reasoning_delta":
                controller.enqueue(
                  encodeData({
                    choices: [
                      { delta: { reasoning_content: event.text } },
                    ],
                  })
                );
                break;
              case "usage":
                controller.enqueue(
                  encodeData({
                    choices: [],
                    usage: {
                      prompt_tokens: event.usage.promptTokens,
                      completion_tokens: event.usage.completionTokens,
                      total_tokens: event.usage.totalTokens,
                      prompt_cache_hit_tokens:
                        event.usage.promptCacheHitTokens,
                      prompt_cache_miss_tokens:
                        event.usage.promptCacheMissTokens,
                    },
                  })
                );
                break;
              case "completed":
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                break;
              default:
                controller.enqueue(
                  encoder.encode(formatAgentEvent(event as AgentEvent))
                );
            }
          }
          if (!cancelled) controller.close();
        } catch (error) {
          if (!cancelled) controller.error(error);
        }
      })();
    },
    async cancel() {
      cancelled = true;
      await iterator.return?.();
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Conversation-Id": run.metadata.conversationId,
      "X-Message-Id": run.metadata.messageId,
      "X-Model-Provider": run.metadata.provider,
      "X-Agent-Orchestrator":
        run.metadata.runtimeMode === "new" ? "enabled" : "disabled",
      "X-Agent-Runtime-Version": run.metadata.runtimeVersion,
      "X-Agent-Tool-Protocol": run.metadata.toolProtocol,
    },
  });
}
