import { completeChat, type DeepSeekMessage } from "@/lib/deepseek";

export type ChatMessage = {
  role: string;
  content: string;
};

export type CompressionOptions = {
  apiKey: string;
  messages: ChatMessage[];
  protectedWindow?: number;
  userPrompt?: string;
  maxSummaryTokens?: number;
};

export type CompressionResult = {
  summary: string;
  compressedCount: number;
};

const DEFAULT_SUMMARY_PROMPT =
  "请把以下对话历史压缩成一份摘要。保留关键事实、用户偏好、约束条件和未完成事项；丢弃寒暄和重复内容。用中文输出。";

/**
 * 从完整消息列表中提取可被压缩的部分：
 * - 保留所有 system 消息
 * - 保留最近 protectedWindow 轮 user/assistant 对话
 * - 其余 user/assistant 对话进入摘要
 */
export function selectCompressibleMessages(
  messages: ChatMessage[],
  protectedWindow = 6
): { protectedMessages: ChatMessage[]; compressible: ChatMessage[] } {
  const systemMessages = messages.filter((m) => m.role === "system");
  const dialogue = messages.filter(
    (m) => m.role === "user" || m.role === "assistant"
  );

  const protectedDialogueSize = protectedWindow * 2;
  if (dialogue.length <= protectedDialogueSize) {
    return { protectedMessages: messages, compressible: [] };
  }

  const compressible = dialogue.slice(0, dialogue.length - protectedDialogueSize);
  const protectedDialogue = dialogue.slice(dialogue.length - protectedDialogueSize);

  return {
    protectedMessages: [...systemMessages, ...protectedDialogue],
    compressible,
  };
}

/**
 * 调用 DeepSeek V4 Flash 对可压缩对话生成摘要。
 */
export async function compressHistory(
  options: CompressionOptions
): Promise<CompressionResult | null> {
  const { protectedWindow = 6, userPrompt, maxSummaryTokens = 2000 } = options;
  const { compressible } = selectCompressibleMessages(
    options.messages,
    protectedWindow
  );

  if (compressible.length === 0) {
    return null;
  }

  const formatted = compressible
    .map((m) => `${m.role === "user" ? "用户" : "助手"}：${m.content}`)
    .join("\n\n");

  const system = userPrompt
    ? `${DEFAULT_SUMMARY_PROMPT}\n\n额外要求：${userPrompt}`
    : DEFAULT_SUMMARY_PROMPT;

  const result = await completeChat(options.apiKey, {
    model: "deepseek-v4-flash",
    messages: [
      { role: "system", content: system } as DeepSeekMessage,
      { role: "user", content: formatted } as DeepSeekMessage,
    ],
    max_tokens: maxSummaryTokens,
  });

  return {
    summary: result.content,
    compressedCount: compressible.length,
  };
}

/**
 * 将摘要插入到消息列表中：放在 system 提示之后、受保护的近期对话之前。
 */
export function buildCompressedMessages(
  originalMessages: ChatMessage[],
  summary: string
): ChatMessage[] {
  const systemMessages = originalMessages.filter((m) => m.role === "system");
  const dialogue = originalMessages.filter(
    (m) => m.role === "user" || m.role === "assistant"
  );

  return [
    ...systemMessages,
    {
      role: "system",
      content: `【此前对话压缩上下文】\n${summary}\n\n请在后续回答中继承这些事实与约束。`,
    },
    ...dialogue,
  ];
}
