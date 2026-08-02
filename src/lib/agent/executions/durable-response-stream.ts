import type { AgentEvent } from "@/lib/agent/types";
import { formatAgentEvent } from "@/lib/agent/event-stream";
import { resolveAgentRuntimeMode } from "@/lib/agent/runtime-mode";
import type {
  AgentExecutionRecord,
  AgentExecutionStore,
} from "./agent-execution-store";
import {
  replayAgentExecutionEvents,
} from "./event-replay";
import {
  encodeDurableAgentEvent,
  type DurableAgentEvent,
} from "./event-codec";

const encoder = new TextEncoder();

type ReplayStore = Pick<
  AgentExecutionStore,
  "getOwnedExecution" | "listEventsAfter"
>;

function withId(sequence: number, body: string) {
  return `id: ${sequence}\n${body}`;
}

function encodeDurable(event: DurableAgentEvent) {
  return withId(
    event.sequence,
    `event: durable\ndata: ${encodeDurableAgentEvent(event)}\n\n`
  );
}

function parseOperationalEvent(event: DurableAgentEvent): AgentEvent | null {
  if (
    event.type !== "agent_event" ||
    !event.payload ||
    typeof event.payload !== "object" ||
    Array.isArray(event.payload) ||
    typeof event.payload.eventJson !== "string"
  ) {
    return null;
  }
  try {
    const parsed = JSON.parse(event.payload.eventJson) as Record<string, unknown>;
    if (parsed.type === "approval_required") parsed.token = "";
    return parsed as unknown as AgentEvent;
  } catch {
    return null;
  }
}

export function encodeChatReplayEvent(event: DurableAgentEvent): string {
  const payload =
    event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
      ? event.payload
      : {};
  if (event.type === "assistant_text" && typeof payload.text === "string") {
    return withId(
      event.sequence,
      `data: ${JSON.stringify({
        choices: [{ delta: { content: payload.text } }],
      })}\n\n`
    );
  }
  if (
    event.type === "assistant_reasoning" &&
    typeof payload.text === "string"
  ) {
    return withId(
      event.sequence,
      `data: ${JSON.stringify({
        choices: [{ delta: { reasoning_content: payload.text } }],
      })}\n\n`
    );
  }
  if (event.type === "assistant_usage") {
    return withId(
      event.sequence,
      `data: ${JSON.stringify({
        choices: [],
        usage: {
          prompt_tokens: payload.prompt ?? 0,
          completion_tokens: payload.completion ?? 0,
          total_tokens: payload.total ?? 0,
          prompt_cache_hit_tokens: payload.cacheHit ?? 0,
          prompt_cache_miss_tokens: payload.cacheMiss ?? 0,
        },
      })}\n\n`
    );
  }
  const operational = parseOperationalEvent(event);
  if (operational) {
    return withId(event.sequence, formatAgentEvent(operational));
  }
  if (event.type === "run_completed") {
    return withId(event.sequence, "data: [DONE]\n\n");
  }
  if (event.type === "run_failed" || event.type === "run_cancelled") {
    return withId(
      event.sequence,
      `event: execution_error\ndata: ${JSON.stringify({
        status: event.type === "run_failed" ? "failed" : "cancelled",
        failureCode: payload.failureCode ?? null,
        ...(typeof payload.message === "string"
          ? { message: payload.message }
          : {}),
      })}\n\n`
    );
  }
  return encodeDurable(event);
}

export function createDurableReplayResponse(input: {
  store: ReplayStore;
  execution: AgentExecutionRecord;
  userId: string;
  afterSequence?: number;
  signal?: AbortSignal;
  format?: "durable" | "chat";
  chatHeaders?: boolean;
}): Response {
  const localAbort = new AbortController();
  const abort = () => localAbort.abort();
  input.signal?.addEventListener("abort", abort, { once: true });
  const replay = replayAgentExecutionEvents({
    store: input.store,
    userId: input.userId,
    executionId: input.execution.id,
    afterSequence: input.afterSequence ?? 0,
    signal: localAbort.signal,
  });

  let keepAlive: ReturnType<typeof setInterval> | null = null;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      keepAlive = setInterval(() => {
        if (!localAbort.signal.aborted) {
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        }
      }, 15_000);
      void (async () => {
        try {
          for await (const event of replay) {
            const serialized =
              input.format === "chat"
                ? encodeChatReplayEvent(event)
                : encodeDurable(event);
            controller.enqueue(encoder.encode(serialized));
          }
          if (!localAbort.signal.aborted) controller.close();
        } catch (error) {
          if (!localAbort.signal.aborted) controller.error(error);
        } finally {
          if (keepAlive) clearInterval(keepAlive);
          keepAlive = null;
          input.signal?.removeEventListener("abort", abort);
        }
      })();
    },
    async cancel() {
      localAbort.abort();
      if (keepAlive) clearInterval(keepAlive);
      keepAlive = null;
      await replay.return?.(undefined);
      input.signal?.removeEventListener("abort", abort);
    },
  });

  const checkpoint = input.execution.checkpoint;
  const headers: Record<string, string> = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "X-Agent-Execution-Id": input.execution.id,
  };
  if (input.chatHeaders) {
    const runtimeMode = resolveAgentRuntimeMode();
    headers["X-Conversation-Id"] = input.execution.conversationId;
    if (input.execution.assistantMessageId) {
      headers["X-Message-Id"] = input.execution.assistantMessageId;
    }
    headers["X-Model-Provider"] =
      checkpoint?.model.provider ?? "deepseek";
    headers["X-Agent-Orchestrator"] =
      runtimeMode === "new" ? "enabled" : "disabled";
    headers["X-Agent-Runtime-Version"] = "1-durable";
    headers["X-Agent-Tool-Protocol"] = "native";
  }

  return new Response(body, { headers });
}
