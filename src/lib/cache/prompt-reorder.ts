import type { cacheExperiments } from "@/lib/cache/experiment-config";

interface CacheMessage {
  role: string;
  content: string;
}

export function reorderMessagesForCache<T extends CacheMessage>(
  messages: T[],
  systemPrompt: string,
  ragContext: string,
  config: typeof cacheExperiments.adaptivePromptOrdering
): T[] {
  if (!config.enabled || !ragContext || messages.length === 0) {
    return messages;
  }

  const next = messages.map((message) => ({ ...message })) as T[];
  const systemIndex = next.findIndex((message) => message.role === "system");
  const userIndex = next.findLastIndex((message) => message.role === "user");
  if (userIndex < 0) return messages;

  if (config.strategy === "frequent-context-to-system" && systemIndex >= 0) {
    next[systemIndex].content =
      `${systemPrompt}\n\n【高频上下文实验】\n${ragContext}`;
    return next;
  }

  next[userIndex].content =
    `# 项目资料\n\n${ragContext}\n\n# 用户问题\n\n${next[userIndex].content}`;
  return next;
}
