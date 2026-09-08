import type { ResearchBudgetProfile, ResearchPlanSnapshot } from "./contracts";

const BUDGET_RANK: Record<ResearchBudgetProfile, number> = {
  quick: 0,
  deep: 1,
  comprehensive: 2,
};

export function isBudgetExpansion(
  current: ResearchBudgetProfile,
  requested: ResearchBudgetProfile
): boolean {
  return BUDGET_RANK[requested] > BUDGET_RANK[current];
}

export function assertBudgetExpansion(
  current: ResearchBudgetProfile,
  requested: ResearchBudgetProfile
): void {
  if (!isBudgetExpansion(current, requested)) {
    throw new Error("新的研究预算必须高于当前预算配置");
  }
}

export function applyConfirmedScopeDirectives(
  plan: ResearchPlanSnapshot,
  directives: readonly string[],
  budgetProfile: ResearchBudgetProfile
): ResearchPlanSnapshot {
  let next = { ...plan, researchIntensity: budgetProfile };
  for (const directive of directives) {
    const normalized = directive.trim();
    if (!normalized) continue;
    const appended = next.researchQuestions.length < 8
      ? [{
          key: `q${next.researchQuestions.length + 1}`,
          title: normalized.length > 48 ? `${normalized.slice(0, 48)}…` : normalized,
          question: normalized,
          priority: "important" as const,
          completionCriteria: ["对新增方向给出直接证据或明确缺口"],
          sourceStrategy: ["沿用当前来源策略并记录新增方向"],
        }]
      : [];
    next = {
      ...next,
      researchGoal: `${next.researchGoal}；补充方向：${normalized}`,
      researchQuestions: [...next.researchQuestions, ...appended],
    };
  }
  return next;
}

export function budgetProfileRank(profile: ResearchBudgetProfile): number {
  return BUDGET_RANK[profile];
}
