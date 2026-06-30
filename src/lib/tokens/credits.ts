/**
 * 信用点换算。
 *
 * 以 DeepSeek V4 Flash 输入 token（缓存未命中）为基准：
 * 1 信用点 = 1000 个 Flash 输入 token。
 * 其他模型 / token 类型按人民币成本比例折算。
 */

export type TokenBreakdown = {
  inputCacheHitTokens: number;
  inputCacheMissTokens: number;
  outputTokens: number;
};

export type CreditWeights = {
  hit: number; // 每 1K cache hit input tokens 的信用点
  miss: number; // 每 1K cache miss / 普通 input tokens 的信用点
  out: number; // 每 1K output tokens 的信用点
};

export const CREDIT_WEIGHTS: Record<string, CreditWeights> = {
  "deepseek-v4-flash": {
    hit: 0.02,
    miss: 1,
    out: 2,
  },
  "deepseek-v4-pro": {
    hit: 0.025,
    miss: 3,
    out: 6,
  },
  "minimax-m3": {
    hit: 0.42,
    miss: 2.1,
    out: 8.4,
  },
};

export function getCreditWeights(model: string): CreditWeights | undefined {
  return CREDIT_WEIGHTS[model];
}

/**
 * 根据分项 token 用量和模型权重计算信用点。
 * 结果向上取整，避免小数信用点。
 */
export function calculateCredits(
  model: string,
  usage: TokenBreakdown
): number {
  const weights = CREDIT_WEIGHTS[model];
  if (!weights) return 0;

  const rawCredits =
    usage.inputCacheHitTokens * weights.hit +
    usage.inputCacheMissTokens * weights.miss +
    usage.outputTokens * weights.out;

  return Math.ceil(rawCredits / 1000);
}

/**
 * 估算本地预算检查用的信用点消耗。
 * 用于在用户发送请求前快速判断剩余额度是否足够。
 */
export function estimateCreditsForBudget(
  model: string,
  estimatedInputTokens: number,
  estimatedOutputTokens: number
): number {
  const weights = CREDIT_WEIGHTS[model];
  if (!weights) return 0;

  const rawCredits =
    estimatedInputTokens * weights.miss +
    estimatedOutputTokens * weights.out;

  return Math.ceil(rawCredits / 1000);
}
