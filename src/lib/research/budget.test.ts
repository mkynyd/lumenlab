import { describe, expect, it } from "vitest";
import { evaluateResearchStop, getResearchBudget, getResearchExplorationBudget, getResearchFinalizationReserve, hasResearchModelBudgetHeadroom, hasResearchModelCallBudget, RESEARCH_CALL_ESTIMATE_SAFETY_FACTOR } from "./budget";

describe("research budget", () => {
  it("keeps comprehensive concurrency bounded at four", () => {
    expect(getResearchBudget("comprehensive").researcherConcurrency).toBe(4);
    expect(getResearchBudget("comprehensive").maxQuestionReplans).toBe(3);
  });

  it("sizes the deep profile for isolated-turn stage calls with a protected finalization reserve", () => {
    // 校准依据（token-composition probe，24 evidence/12 claim 的 deep Run）：
    // 阶段调用改为 isolatedTurn（不重放历史）+ 摘录分级截断后，17 次调用完整
    // 序列约 289k tokens；15 来源重证据 Run 约 400-450k。deep 总额 480k =
    // 探索 352k + 收尾预留 128k（verifier/architect/writer/auditor 实测
    // 20-28k/次 × 4 ≈ 98k + 30% 余量）。
    const total = getResearchBudget("deep");
    const reserve = getResearchFinalizationReserve("deep");
    const exploration = getResearchExplorationBudget("deep");
    expect(total.maxTokens).toBe(480_000);
    expect(reserve.maxTokens).toBe(128_000);
    expect(exploration.maxTokens).toBe(352_000);
    expect(total.maxCostCredits).toBe(1_440);
    expect(reserve.maxCostCredits).toBe(384);
    expect(exploration.maxCostCredits).toBe(1_056);
  });

  it("keeps comprehensive strictly above deep", () => {
    expect(getResearchBudget("comprehensive").maxTokens).toBeGreaterThan(getResearchBudget("deep").maxTokens);
    expect(getResearchExplorationBudget("comprehensive").maxTokens).toBeGreaterThan(getResearchExplorationBudget("deep").maxTokens);
    expect(getResearchBudget("comprehensive").maxTokens).toBe(720_000);
  });

  it("gates model calls on token and credit headroom", () => {
    const limits = getResearchBudget("deep");
    expect(hasResearchModelBudgetHeadroom({ limits, totalTokens: 0, costCredits: 0 })).toBe(true);
    expect(hasResearchModelBudgetHeadroom({ limits, totalTokens: limits.maxTokens - 1, costCredits: 0 })).toBe(true);
    expect(hasResearchModelBudgetHeadroom({ limits, totalTokens: limits.maxTokens, costCredits: 0 })).toBe(false);
    expect(hasResearchModelBudgetHeadroom({ limits, totalTokens: 0, costCredits: limits.maxCostCredits })).toBe(false);
    expect(hasResearchModelBudgetHeadroom({ limits })).toBe(true);
  });

  it("estimate-aware gate requires headroom for estimate times the safety factor", () => {
    const limits = getResearchBudget("deep");
    // 余量充足：一次性通过。
    expect(hasResearchModelCallBudget({ limits, totalTokens: 0, costCredits: 0, estimateTokens: 24_000 })).toBe(true);
    // 余量低于 预估 × 1.5：拦截（生产两次 Run 的跳变式超支形态）。
    const remaining = Math.ceil(24_000 * RESEARCH_CALL_ESTIMATE_SAFETY_FACTOR) - 1;
    expect(hasResearchModelCallBudget({ limits, totalTokens: limits.maxTokens - remaining, costCredits: 0, estimateTokens: 24_000 })).toBe(false);
    // 恰好等于 预估 × 1.5：放行。
    expect(hasResearchModelCallBudget({ limits, totalTokens: limits.maxTokens - Math.ceil(24_000 * RESEARCH_CALL_ESTIMATE_SAFETY_FACTOR), costCredits: 0, estimateTokens: 24_000 })).toBe(true);
    // 无估计值：退回纯余量检查。
    expect(hasResearchModelCallBudget({ limits, totalTokens: limits.maxTokens - 1, costCredits: 0 })).toBe(true);
    // 硬顶已触：无论估计值都拦截。
    expect(hasResearchModelCallBudget({ limits, totalTokens: limits.maxTokens, costCredits: 0, estimateTokens: 1 })).toBe(false);
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
