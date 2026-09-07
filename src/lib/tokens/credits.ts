/**
 * 信用点换算。
 *
 * 以 DeepSeek V4 Flash 输入 token（缓存未命中）为基准：
 * 1 信用点 = 1000 个 Flash 输入 token。
 * 其他模型 / token 类型按人民币成本比例折算。
 *
 * DeepSeek 实行峰谷定价（Asia/Shanghai，周一至周五 9:00-12:00、
 * 14:00-18:00 为高峰）：计费档按请求开始时间冻结，由调用方在回合开始
 * 算好档位（或传入请求开始时间）后传入，不按结算时刻重算。
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

/** DeepSeek 峰谷计费档 */
export type DeepSeekBillingTier = "peak" | "off_peak";

/**
 * 结算新用量时遇到未配置权重的模型抛出，阻止按 0 信用点免费结算。
 * 历史已结算记录的读取路径（如用量页成本估算）不经过本错误，
 * 见 getCreditWeightsForUsage 的 undefined 返回。
 */
export class UnknownModelCreditError extends Error {
  constructor(readonly model: string) {
    super(`模型 ${model} 未配置计费权重，已阻止结算`);
    this.name = "UnknownModelCreditError";
  }
}

// 历史模型权重保留不动：历史账单按结算时的规则入账，不重算。
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
  // Qwen3.7-Plus China (Beijing), 0-256K input tier. Cache hits are charged
  // at 10% of the corresponding input rate; see the current Model Studio bill.
  "qwen3.7-plus": {
    hit: 0.2,
    miss: 2,
    out: 8,
  },
  // Qwen3.8-Flash：普通交互档（元/百万 tokens：命中 0.1 / 未命中 0.8 / 输出 2.7）。
  // 不套用 Batch、显式缓存创建档位，也不沿用 qwen3.7-plus 的长上下文档位。
  "qwen3.8-flash": {
    hit: 0.1,
    miss: 0.8,
    out: 2.7,
  },
};

// DeepSeek V4 Flash Vision Exp 峰谷两档（元/百万 tokens）：
// 低谷 命中 0.05 / 未命中 1.5 / 输出 4.5；高峰 命中 0.10 / 未命中 3.0 / 输出 9.0。
const DEEPSEEK_V4_FLASH_VISION_EXP_WEIGHTS: Record<
  DeepSeekBillingTier,
  CreditWeights
> = {
  off_peak: { hit: 0.05, miss: 1.5, out: 4.5 },
  peak: { hit: 0.1, miss: 3, out: 9 },
};

const QWEN_LONG_CONTEXT_WEIGHTS: CreditWeights = {
  hit: 0.6,
  miss: 6,
  out: 24,
};

const DEEPSEEK_TIERED_MODELS = new Set(["deepseek-v4-flash-vision-exp"]);

const DEEPSEEK_BILLING_TIME_ZONE = "Asia/Shanghai";

const deepSeekTierFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: DEEPSEEK_BILLING_TIME_ZONE,
  weekday: "short",
  hour: "numeric",
  hourCycle: "h23",
});

/**
 * DeepSeek 峰谷计费档：Asia/Shanghai 周一至周五 9:00-12:00、14:00-18:00
 * 为高峰，其余时间（含周末全天）为低谷。
 * 入参必须是请求开始时间，由调用方在回合开始冻结后传入。
 */
export function deepSeekBillingTier(at: Date): DeepSeekBillingTier {
  const parts = Object.fromEntries(
    deepSeekTierFormatter
      .formatToParts(at)
      .map((part) => [part.type, part.value])
  );
  const weekday = parts.weekday ?? "";
  const hour = Number(parts.hour ?? "0");
  const isWeekday = ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(weekday);
  const isPeakHour = (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18);
  return isWeekday && isPeakHour ? "peak" : "off_peak";
}

export function getCreditWeights(
  model: string,
  deepSeekTier: DeepSeekBillingTier = "off_peak"
): CreditWeights | undefined {
  if (DEEPSEEK_TIERED_MODELS.has(model)) {
    return DEEPSEEK_V4_FLASH_VISION_EXP_WEIGHTS[deepSeekTier];
  }
  return CREDIT_WEIGHTS[model];
}

export function getCreditWeightsForUsage(
  model: string,
  inputTokens: number,
  options?: { deepSeekTier?: DeepSeekBillingTier }
): CreditWeights | undefined {
  if (model === "qwen3.7-plus" && inputTokens > 256_000) {
    return QWEN_LONG_CONTEXT_WEIGHTS;
  }
  return getCreditWeights(model, options?.deepSeekTier ?? "off_peak");
}

/**
 * 根据分项 token 用量和模型权重计算信用点。
 * 结果向上取整，避免小数信用点。
 *
 * 未知模型抛 UnknownModelCreditError 阻止结算；options.requestStartedAt
 * 为请求开始时间，DeepSeek 峰谷档按它判定，缺省按低谷计价。
 */
export function calculateCredits(
  model: string,
  usage: TokenBreakdown,
  options?: { requestStartedAt?: Date }
): number {
  const weights = getCreditWeightsForUsage(
    model,
    usage.inputCacheHitTokens + usage.inputCacheMissTokens,
    {
      deepSeekTier: options?.requestStartedAt
        ? deepSeekBillingTier(options.requestStartedAt)
        : undefined,
    }
  );
  if (!weights) throw new UnknownModelCreditError(model);

  const rawCredits =
    usage.inputCacheHitTokens * weights.hit +
    usage.inputCacheMissTokens * weights.miss +
    usage.outputTokens * weights.out;

  // 权重是十进制小数，先按 1e-6 精度舍去二进制浮点噪声再向上取整，
  // 避免 6050000.000000001 这类误差被 ceil 多计一个信用点。
  return Math.ceil(Math.round(rawCredits * 1e6) / 1e9);
}

/**
 * 估算本地预算检查用的信用点消耗。
 * 用于在用户发送请求前快速判断剩余额度是否足够。
 */
export function estimateCreditsForBudget(
  model: string,
  estimatedInputTokens: number,
  estimatedOutputTokens: number,
  options?: { requestStartedAt?: Date }
): number {
  const weights = getCreditWeightsForUsage(model, estimatedInputTokens, {
    deepSeekTier: options?.requestStartedAt
      ? deepSeekBillingTier(options.requestStartedAt)
      : undefined,
  });
  if (!weights) return 0;

  const rawCredits =
    estimatedInputTokens * weights.miss +
    estimatedOutputTokens * weights.out;

  return Math.ceil(Math.round(rawCredits * 1e6) / 1e9);
}
