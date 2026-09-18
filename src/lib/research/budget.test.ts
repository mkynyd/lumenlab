import { describe, expect, it } from "vitest";
import { evaluateResearchStop, getResearchBudget, getResearchExplorationBudget, getResearchFinalizationReserve, hasResearchModelBudgetHeadroom } from "./budget";

describe("research budget", () => {
  it("keeps comprehensive concurrency bounded at four", () => {
    expect(getResearchBudget("comprehensive").researcherConcurrency).toBe(4);
    expect(getResearchBudget("comprehensive").maxQuestionReplans).toBe(3);
  });

  it("sizes the deep profile for real multi-attachment runs with a protected finalization reserve", () => {
    // 生产校准：一次 15 份资料的 deep Run 探索阶段实测消耗约 585k tokens，
    // 旧上限 160k 在收尾前被打穿。deep 总额 640k = 探索 544k + 收尾预留 96k。
    const total = getResearchBudget("deep");
    const reserve = getResearchFinalizationReserve("deep");
    const exploration = getResearchExplorationBudget("deep");
    expect(total.maxTokens).toBe(640_000);
    expect(reserve.maxTokens).toBe(96_000);
    expect(exploration.maxTokens).toBe(544_000);
    expect(total.maxCostCredits).toBe(1_920);
    expect(reserve.maxCostCredits).toBe(288);
    expect(exploration.maxCostCredits).toBe(1_632);
  });

  it("keeps comprehensive strictly above deep", () => {
    expect(getResearchBudget("comprehensive").maxTokens).toBeGreaterThan(getResearchBudget("deep").maxTokens);
    expect(getResearchExplorationBudget("comprehensive").maxTokens).toBeGreaterThan(getResearchExplorationBudget("deep").maxTokens);
  });

  it("gates model calls on token and credit headroom", () => {
    const limits = getResearchBudget("deep");
    expect(hasResearchModelBudgetHeadroom({ limits, totalTokens: 0, costCredits: 0 })).toBe(true);
    expect(hasResearchModelBudgetHeadroom({ limits, totalTokens: limits.maxTokens - 1, costCredits: 0 })).toBe(true);
    expect(hasResearchModelBudgetHeadroom({ limits, totalTokens: limits.maxTokens, costCredits: 0 })).toBe(false);
    expect(hasResearchModelBudgetHeadroom({ limits, totalTokens: 0, costCredits: limits.maxCostCredits })).toBe(false);
    expect(hasResearchModelBudgetHeadroom({ limits })).toBe(true);
  });

  it("does not stop while critical work is pending", () => {
    const limits = getResearchBudget("quick");
    expect(
      evaluateResearchStop({
        limits,
        modelCalls: limits.modelCalls,
        searchCalls: 0,
        fetchCalls: 0,
        sourceCount: 0,
        elapsedMs: 0,
        criticalQuestionsResolved: false,
        semanticCoverage: 0.2,
        sourceDiversity: 0,
        independentCorroboration: 0,
        conflictCoverage: 0,
        informationGain: 0.4,
        hasPendingCriticalWork: true,
      })
    ).toMatchObject({ stop: true, reason: "critical_work_pending" });
  });

  it("stops when coverage and corroboration are sufficient", () => {
    const limits = getResearchBudget("deep");
    expect(
      evaluateResearchStop({
        limits,
        modelCalls: 2,
        searchCalls: 2,
        fetchCalls: 2,
        sourceCount: 4,
        elapsedMs: 1_000,
        criticalQuestionsResolved: true,
        semanticCoverage: 0.95,
        sourceDiversity: 0.8,
        independentCorroboration: 0.9,
        conflictCoverage: 0.9,
        informationGain: 0.2,
        hasPendingCriticalWork: false,
      })
    ).toMatchObject({ stop: true, reason: "semantic_coverage" });
  });

  it("stops when token or credit hard budgets are exhausted", () => {
    const limits = getResearchBudget("quick");
    expect(evaluateResearchStop({
      limits,
      modelCalls: 0,
      totalTokens: limits.maxTokens,
      costCredits: 0,
      searchCalls: 0,
      fetchCalls: 0,
      sourceCount: 0,
      elapsedMs: 0,
      criticalQuestionsResolved: true,
      semanticCoverage: 0,
      sourceDiversity: 0,
      independentCorroboration: 0,
      conflictCoverage: 0,
      informationGain: 0,
      hasPendingCriticalWork: false,
    })).toMatchObject({ stop: true, reason: "hard_budget" });
  });
});
