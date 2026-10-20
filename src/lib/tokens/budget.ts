import { countMessageTokens } from "./tokenizer";
import type { DeepSeekMessage } from "@/lib/deepseek";

export const MODEL_CONTEXT_LIMIT = 1_000_000; // DeepSeek V4 / MiniMax M3
export const OUTPUT_RESERVE = 160_000; // 容纳最大 128K 思考+正文输出及 RAG/工具余量
export const CONTEXT_BUDGET = MODEL_CONTEXT_LIMIT - OUTPUT_RESERVE;

export const WARN_THRESHOLD = 0.7;
export const COMPRESS_THRESHOLD = 0.9;

export type BudgetStatus = "ok" | "warn" | "compress" | "overflow";

export type BudgetCheckResult = {
  status: BudgetStatus;
  tokens: number;
  ratio: number;
  budget: number;
};

/**
 * 检查消息数组是否接近或超过上下文预算。
 */
export function checkContextBudget(
  messages: Array<Pick<DeepSeekMessage, "role" | "content">>,
  options?: { budget?: number }
): BudgetCheckResult {
  const tokens = countMessageTokens(messages);
  const budget = options?.budget ?? CONTEXT_BUDGET;
  const ratio = tokens / budget;

  let status: BudgetStatus = "ok";
  if (ratio >= 1) {
    status = "overflow";
  } else if (ratio >= COMPRESS_THRESHOLD) {
    status = "compress";
  } else if (ratio >= WARN_THRESHOLD) {
    status = "warn";
  }

  return {
    status,
    tokens,
    ratio,
    budget,
  };
}
