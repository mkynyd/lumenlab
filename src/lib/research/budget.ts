import type {
  ResearchBudgetLimits,
  ResearchBudgetProfile,
  ResearchStopDecision,
  ResearchStopInput,
} from "./contracts";

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
  },
  deep: {
    profile: "deep",
    wallTimeMs: 30 * 60_000,
    modelCalls: 40,
    searchCalls: 24,
    fetchCalls: 40,
    maxSources: 40,
    maxTokens: 160_000,
    maxCostCredits: 480,
    researcherConcurrency: 4,
    maxReplans: 3,
    maxVerificationRepairs: 2,
  },
  comprehensive: {
    profile: "comprehensive",
    wallTimeMs: 2 * 60 * 60_000,
    modelCalls: 100,
    searchCalls: 72,
    fetchCalls: 120,
    maxSources: 120,
    maxTokens: 480_000,
    maxCostCredits: 1_500,
    researcherConcurrency: 4,
    maxReplans: 6,
    maxVerificationRepairs: 4,
  },
};

export function getResearchBudget(profile: ResearchBudgetProfile): ResearchBudgetLimits {
  return { ...RESEARCH_BUDGETS[profile] };
}

export function canStartResearcher(
  limits: ResearchBudgetLimits,
  activeResearchers: number
): boolean {
  return activeResearchers < limits.researcherConcurrency;
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
