import { getEncoding } from "js-tiktoken";
import type { DeepSeekMessage } from "@/lib/deepseek";

const ENCODING_NAME = "cl100k_base";

function getEncoder() {
  return getEncoding(ENCODING_NAME);
}

/**
 * 估算单段文本的 token 数。
 * 使用 cl100k_base 做保守估算，适用于 DeepSeek / MiniMax 的 Anthropic 兼容接口。
 */
export function countTokens(text: string): number {
  return getEncoder().encode(text).length;
}

/**
 * 估算消息数组的总 token 数。
 * 包含消息格式开销（每条 4 tokens）和请求级 priming offset（2 tokens）。
 */
export function countMessageTokens(
  messages: Array<Pick<DeepSeekMessage, "role" | "content">>
): number {
  const enc = getEncoder();
  let total = 0;
  for (const message of messages) {
    // 角色 + 内容 + 格式开销
    total += 4;
    total += enc.encode(message.role).length;
    // Native tool continuations contain text/tool_use/tool_result blocks.
    // Include the serialized structure and arguments in the estimate while
    // retaining the original blocks for the provider and durable replay.
    const content = typeof message.content === "string"
      ? message.content
      : JSON.stringify(message.content);
    total += enc.encode(content).length;
  }
  total += 2; // priming offset
  return total;
}

/**
 * 多模态附件的占位 token 估算。
 * 本地无法精确计算图片 / 视频 token，使用保守占位值。
 */
export function estimateMediaTokens(mediaCount: number): number {
  return mediaCount * 256;
}
