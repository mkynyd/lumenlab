import type {
  ResearchBudgetLimits,
  ResearchBudgetProfile,
  ResearchFinalizationBudgetReserve,
  ResearchStopDecision,
  ResearchStopInput,
} from "./contracts";

/**
 * 收尾预留：核验/架构/写作/审计（+最多一次修订）四个阶段的 model/tokens/credits。
 * deep 档数值按生产实测校准：一次 15 份资料的真实 deep Run 探索阶段消耗约
 * 585k tokens（16 次调用、平均 42k input tokens/次），旧上限 160k 在收尾前
 * 就被打穿，导致 canUseFinalizationModel 直接跳过全部收尾阶段。deep 总额
 * 640k = 探索 544k + 收尾预留 96k（≈6 次收尾调用 × 15–25k input）；
 * comprehensive 保持高于 deep（1.5×）。档位只由 profile 决定、不随附件数动态
 * 变化，保证 durable 重放时预算口径稳定。
 */
export const RESEARCH_FINALIZATION_RESERVES: Record<ResearchBudgetProfile, ResearchFinalizationBudgetReserve> = {
  quick: { modelCalls: 6, maxTokens: 12_000, maxCostCredits: 36 },
  deep: { modelCalls: 6, maxTokens: 96_000, maxCostCredits: 288 },
  comprehensive: { modelCalls: 6, maxTokens: 144_000, maxCostCredits: 432 },
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
    maxTokens: 640_000,
    maxCostCredits: 1_920,
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
    maxTokens: 960_000,
    maxCostCredits: 3_000,
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
