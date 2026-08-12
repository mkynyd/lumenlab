import type { ChatMessage } from "@/lib/hooks/use-chat";
import type { AssistantProcessTrace } from "@/lib/agent/assistant-process";
import type { AgentSource } from "@/lib/agent/sources";

export type PersistedConversationMessage = {
  id: string;
  role: string;
  content: string;
  reasoningContent?: string | null;
  tokenCount?: number | null;
  cacheHitTokens?: number | null;
  cacheMissTokens?: number | null;
  sources?: AgentSource[] | null;
  process?: AssistantProcessTrace;
  createdAt?: string | Date | null;
};

export const PENDING_ASSISTANT_RECOVERY_WINDOW_MS = 30 * 60 * 1000;

export function isEmptyAssistantPlaceholder(
  message: PersistedConversationMessage
) {
  return (
    message.role === "assistant" &&
    !message.content.trim() &&
    !message.reasoningContent?.trim() &&
    message.tokenCount == null
  );
}

function isRecoverableAssistantPlaceholder(
  message: PersistedConversationMessage,
  nowMs: number
) {
  if (!isEmptyAssistantPlaceholder(message) || !message.createdAt) {
    return false;
  }

  const createdAtMs = new Date(message.createdAt).getTime();
  return (
    Number.isFinite(createdAtMs) &&
    nowMs - createdAtMs <= PENDING_ASSISTANT_RECOVERY_WINDOW_MS
  );
}

export function toChatMessages(
  messages: PersistedConversationMessage[],
  nowMs = Date.now()
): ChatMessage[] {
  const pendingIndex = messages.reduce(
    (foundIndex, message, index) =>
      isRecoverableAssistantPlaceholder(message, nowMs) ? index : foundIndex,
    -1
  );

  return messages.map((message, index) => ({
    ...message,
    createdAt:
      message.createdAt instanceof Date
        ? message.createdAt.toISOString()
        : message.createdAt ?? undefined,
    role: message.role as "user" | "assistant" | "system",
    isStreaming: index === pendingIndex || undefined,
    streamingSource: index === pendingIndex ? "background" : undefined,
  }));
}
