import { describe, expect, it } from "vitest";
import { evaluateResearchStop, getResearchBudget } from "./budget";

describe("research budget", () => {
  it("keeps comprehensive concurrency bounded at four", () => {
    expect(getResearchBudget("comprehensive").researcherConcurrency).toBe(4);
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
