import type {
  ResearchBudgetLimits,
  ResearchBudgetProfile,
  ResearchFinalizationBudgetReserve,
  ResearchStopDecision,
  ResearchStopInput,
} from "./contracts";

/**
 * 收尾预留：核验/架构/写作/审计（+最多一次修订）四个阶段的 model/tokens/credits。
 * 数值按「历史重发消除后」的实测构成校准（见 token-composition probe）：
 * 阶段调用只携带 system prompt + 自包含 prompt，verifier/architect/writer/auditor
 * 单次 20-28k tokens（15 来源、~40 条 evidence 时），四次收尾 ≈ 98k，预留 128k
 * 覆盖典型四次 + 30% 余量；一次修订轮（writer+auditor 再各一次）由探索余量兜底。
 * deep 总额 480k = 探索 352k + 收尾预留 128k：5-15 来源正常研究实测约 200-350k
 * 可完整跑完，异常消耗被预估闸门在 ~1.5 次调用内拦停。档位只由 profile 决定、
 * 不随附件数动态变化，保证 durable 重放时预算口径稳定。
 */
export const RESEARCH_FINALIZATION_RESERVES: Record<ResearchBudgetProfile, ResearchFinalizationBudgetReserve> = {
  quick: { modelCalls: 6, maxTokens: 12_000, maxCostCredits: 36 },
  deep: { modelCalls: 6, maxTokens: 128_000, maxCostCredits: 384 },
  comprehensive: { modelCalls: 6, maxTokens: 192_000, maxCostCredits: 576 },
};

export const RESEARCH_BUDGETS: Record<ResearchBudgetProfile, ResearchBudgetLimits> = {
  quick: {
    profile: "quick",
    wallTimeMs: 5 * 60_000,
    modelCalls: 12,
    searchCalls: 8,
    fetchCalls: 12,
    maxSources: 12,
    maxTokens: 40_000,
    maxCostCredits: 120,
    researcherConcurrency: 2,
    maxReplans: 1,
    maxVerificationRepairs: 1,
    maxQuestionResearchAttempts: 2,
    maxQuestionEvaluateAttempts: 2,
    maxQuestionReplans: 1,
  },
  deep: {
    profile: "deep",
    wallTimeMs: 30 * 60_000,
    modelCalls: 40,
    searchCalls: 24,
    fetchCalls: 40,
    maxSources: 40,
    maxTokens: 480_000,
    maxCostCredits: 1_440,
    researcherConcurrency: 4,
    maxReplans: 3,
    maxVerificationRepairs: 2,
    maxQuestionResearchAttempts: 3,
    maxQuestionEvaluateAttempts: 3,
    maxQuestionReplans: 2,
  },
  comprehensive: {
    profile: "comprehensive",
    wallTimeMs: 2 * 60 * 60_000,
    modelCalls: 100,
    searchCalls: 72,
    fetchCalls: 120,
    maxSources: 120,
    maxTokens: 720_000,
    maxCostCredits: 2_160,
    researcherConcurrency: 4,
    maxReplans: 6,
    maxVerificationRepairs: 4,
    maxQuestionResearchAttempts: 4,
    maxQuestionEvaluateAttempts: 4,
    maxQuestionReplans: 3,
  },
};

export function getResearchBudget(profile: ResearchBudgetProfile): ResearchBudgetLimits {
  return { ...RESEARCH_BUDGETS[profile] };
}

export function getResearchFinalizationReserve(profile: ResearchBudgetProfile): ResearchFinalizationBudgetReserve {
  return { ...RESEARCH_FINALIZATION_RESERVES[profile] };
}

/** Discovery/evaluation may only consume the budget left after mandatory finishing work. */
export function getResearchExplorationBudget(profile: ResearchBudgetProfile): ResearchBudgetLimits {
  const limits = getResearchBudget(profile);
  const reserve = getResearchFinalizationReserve(profile);
  return {
    ...limits,
    modelCalls: Math.max(0, limits.modelCalls - reserve.modelCalls),
    maxTokens: Math.max(0, limits.maxTokens - reserve.maxTokens),
    maxCostCredits: Math.max(0, limits.maxCostCredits - reserve.maxCostCredits),
  };
}

export function finalizationBudgetRemaining(input: {
  limits: ResearchBudgetLimits;
  modelCalls: number;
  totalTokens: number;
  costCredits: number;
}) {
  return {
    modelCalls: Math.max(0, input.limits.modelCalls - input.modelCalls),
    maxTokens: Math.max(0, input.limits.maxTokens - input.totalTokens),
    maxCostCredits: Math.max(0, input.limits.maxCostCredits - input.costCredits),
  };
}

export function canStartResearcher(
  limits: ResearchBudgetLimits,
  activeResearchers: number
): boolean {
  return activeResearchers < limits.researcherConcurrency;
}

export type ResearchBudgetCounter = "modelCalls" | "searchCalls" | "fetchCalls" | "sourceCount";

export type ResearchBudgetCounters = Pick<
  ResearchStopInput,
  "modelCalls" | "searchCalls" | "fetchCalls" | "sourceCount"
>;

function limitForCounter(limits: ResearchBudgetLimits, counter: ResearchBudgetCounter) {
  return counter === "sourceCount" ? limits.maxSources : limits[counter];
}

/**
 * Reserve one bounded operation synchronously before an async provider/model
 * call. Because the reservation mutates the shared checkpoint state before
 * the first await, concurrent Researchers cannot oversubscribe a hard limit.
 */
export function tryReserveResearchBudgetCounter(
  counters: ResearchBudgetCounters,
  limits: ResearchBudgetLimits,
  counter: ResearchBudgetCounter,
) {
  if (counters[counter] >= limitForCounter(limits, counter)) return false;
  counters[counter] += 1;
  return true;
}

/** Release a reservation when an operation did not produce the counted item. */
export function releaseResearchBudgetCounter(counters: ResearchBudgetCounters, counter: ResearchBudgetCounter) {
  counters[counter] = Math.max(0, counters[counter] - 1);
}

/**
 * 发起一次模型调用前的 token/credit 余量检查（纯内存比较，无副作用）。
 * 调用计数由 tryReserveResearchBudgetCounter 同步预留，但单次调用的实际
 * token 消耗在返回前未知；生产 deep Run 曾因此只按调用计数放行、连续烧掉
 * 585k tokens。在 researching 循环内每次模型调用前检查本函数，余量为 0 时
 * 优雅停止探索而不是继续烧钱后跳过收尾。
 */
export function hasResearchModelBudgetHeadroom(input: {
  limits: ResearchBudgetLimits;
  totalTokens?: number;
  costCredits?: number;
}): boolean {
  return (input.totalTokens ?? 0) < input.limits.maxTokens && (input.costCredits ?? 0) < input.limits.maxCostCredits;
}

/**
 * 单次调用消耗的安全系数：余量 ≥ 上次同阶段实测 × 1.5 才发起。余量检查
 * 挡不住「单次 call 跳变式超支」——检查通过时余量足够，一次 call 消耗几十万
 * token 直接越过线（生产两次 deep Run 均因此打穿 640k 上限）。估计值只用于
 * go/no-go 决策，不改变 budget 纯函数语义。
 */
export const RESEARCH_CALL_ESTIMATE_SAFETY_FACTOR = 1.5;

/** 角色无任何历史实测时的保守默认估计（自包含阶段调用 system+prompt 的体量）。 */
export const RESEARCH_DEFAULT_CALL_ESTIMATE_TOKENS = 24_000;

/**
 * 预估感知的调用闸门：既有余量硬检查，又要求剩余预算够覆盖「上次同阶段调用
 * 实测 × 安全系数」。estimateTokens 为 0/缺省时退回纯余量检查。
 */
export function hasResearchModelCallBudget(input: {
  limits: ResearchBudgetLimits;
  totalTokens?: number;
  costCredits?: number;
  estimateTokens?: number;
}): boolean {
  if (!hasResearchModelBudgetHeadroom(input)) return false;
  const estimate = input.estimateTokens ?? 0;
  if (estimate <= 0) return true;
  const remaining = input.limits.maxTokens - (input.totalTokens ?? 0);
  return remaining >= estimate * RESEARCH_CALL_ESTIMATE_SAFETY_FACTOR;
}

export function evaluateResearchStop(input: ResearchStopInput): ResearchStopDecision {
  const hardBudgetExceeded =
    input.elapsedMs >= input.limits.wallTimeMs ||
    input.modelCalls >= input.limits.modelCalls ||
    (input.totalTokens ?? 0) >= input.limits.maxTokens ||
    (input.costCredits ?? 0) >= input.limits.maxCostCredits ||
    input.searchCalls >= input.limits.searchCalls ||
    input.fetchCalls >= input.limits.fetchCalls ||
    input.sourceCount >= input.limits.maxSources;

  if (hardBudgetExceeded) {
    return input.hasPendingCriticalWork && !input.criticalQuestionsResolved
      ? {
          stop: true,
          reason: "critical_work_pending",
          summary: "硬预算已用尽，仍有关键研究问题未完成。",
        }
      : {
          stop: true,
          reason: "hard_budget",
          summary: "已达到本次研究的硬预算上限。",
        };
  }

  if (input.hasPendingCriticalWork && !input.criticalQuestionsResolved) {
    return {
      stop: false,
      reason: "critical_work_pending",
      summary: "优先完成尚未解决的关键研究问题。",
    };
  }

  if (
    input.semanticCoverage >= 0.9 &&
    input.sourceDiversity >= 0.6 &&
    input.independentCorroboration >= 0.6 &&
    input.conflictCoverage >= 0.8
  ) {
    return {
      stop: true,
      reason: "semantic_coverage",
      summary: "研究问题已达到语义覆盖、来源多样性与交叉验证阈值。",
    };
  }

  if (input.informationGain <= 0.05 && input.semanticCoverage >= 0.75) {
    return {
      stop: true,
      reason: "no_information_gain",
      summary: "新增检索带来的信息增益已很低。",
    };
  }

  return { stop: false, reason: "continue", summary: "仍有可解释的研究缺口。" };
}
