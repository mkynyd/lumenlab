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
import { INTELLIGENT_UI_EVENT, MESSAGE_ATTACHMENTS_EVENT } from "@/lib/agent/event-stream";
import type { ChatAttachmentDto } from "@/lib/chat/message-attachments";
import { readUIEvent, type UIEvent } from "@/lib/chat/intelligent-ui/events";

export interface SSEAgentCallbacks {
  onAgentEvent?: (event: AgentEvent) => void;
  onEventId?: (sequence: number) => void;
  onMessageAttachments?: (attachments: ChatAttachmentDto[]) => void;
  onIntelligentUI?: (event: UIEvent) => void | Promise<void>;
  onIntelligentUIAppend?: () => void;
  onDiscardUIPreview?: () => void;
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
  let eventName = "";
  let sequence: number | undefined;
  let dataLines: string[] = [];
  let usage: UsageInfo | null = null;

  function json(data: string) {
    try { return JSON.parse(data); } catch { return null; }
  }

  async function applyUI(data: string) {
    const event = readUIEvent(json(data));
    if (event?.kind === "append") options.onIntelligentUIAppend?.();
    if (event) await options.onIntelligentUI?.(event);
    return false;
  }

  function apply(name: string, data: string): boolean | Promise<boolean> {
    if (name === "execution_error") {
      const payload = json(data) as { status?: "failed" | "cancelled"; failureCode?: string; message?: string } | null;
      const status = payload?.status === "cancelled" ? "cancelled" : "failed";
      options.onDiscardUIPreview?.();
      throw new SSEExecutionError(
        payload?.message ?? (status === "cancelled" ? "执行已取消" : "执行失败，请重试"),
        status,
        payload?.failureCode ?? null,
      );
    }
    if (name === MESSAGE_ATTACHMENTS_EVENT) {
      const attachments = json(data);
      if (Array.isArray(attachments)) options.onMessageAttachments?.(attachments as ChatAttachmentDto[]);
      return false;
    }
    if (name === "agent") {
      const parsed = json(data) as AgentEvent | null;
      if (parsed) options.onAgentEvent?.(parsed);
      return false;
    }
    if (name === INTELLIGENT_UI_EVENT) {
      return options.onIntelligentUI ? applyUI(data) : false;
    }
    if (name === "durable") {
      if (options.onDiscardUIPreview) {
        const type = (json(data) as { type?: string } | null)?.type;
        if (type === "run_claimed" || type === "run_retry_scheduled" || type === "lease_expired") {
          options.onDiscardUIPreview();
        }
      }
      return false;
    }
    if (name && name !== "message") return false;
    if (data === "[DONE]") {
      onChunk({ content: "", reasoningContent: "", done: true });
      return true;
    }

    const payload = json(data);
    if (!payload) return false;
    const stats = payload.usage;
    if (stats) {
      usage = {
        promptTokens: stats.prompt_tokens ?? 0,
        completionTokens: stats.completion_tokens ?? 0,
        totalTokens: stats.total_tokens ?? 0,
        cacheHitTokens: stats.prompt_cache_hit_tokens ?? 0,
        cacheMissTokens: stats.prompt_cache_miss_tokens ?? 0,
      };
    }
    const delta = payload.choices?.[0]?.delta;
    onChunk({ content: delta?.content || "", reasoningContent: delta?.reasoning_content || "", done: false });
    return false;
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const rawLine of lines) {
        const line = rawLine.replace(/\r$/, "");
        if (line === "") {
          if (dataLines.length > 0) {
            const result = apply(eventName, dataLines.join("\n"));
            const complete = typeof result === "boolean" ? result : await result;
            if (sequence !== undefined) options.onEventId?.(sequence);
            if (complete) return { content: "", reasoningContent: "", usage, done: true };
          }
          eventName = "";
          sequence = undefined;
          dataLines = [];
          continue;
        }
        const separator = line.indexOf(":");
        if (separator === 0) continue;
        const field = separator < 0 ? line : line.slice(0, separator);
        const fieldValue = separator < 0 ? "" : line.slice(separator + 1).replace(/^ /, "");
        if (field === "event") eventName = fieldValue;
        if (field === "data") dataLines.push(fieldValue);
        if (field === "id") {
          const id = Number(fieldValue);
          if (Number.isSafeInteger(id) && id > 0) sequence = id;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { content: "", reasoningContent: "", usage, done: false };
}
