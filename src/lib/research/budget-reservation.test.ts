import { describe, expect, it } from "vitest";
import { getResearchBudget, getResearchExplorationBudget, getResearchFinalizationReserve, releaseResearchBudgetCounter, tryReserveResearchBudgetCounter, type ResearchBudgetCounters } from "./budget";

function counters(): ResearchBudgetCounters {
  return { modelCalls: 0, searchCalls: 0, fetchCalls: 0, sourceCount: 0 };
}

describe("research budget reservations", () => {
  it("bounds synchronous reservations made by concurrent Researchers", () => {
    const limits = { ...getResearchBudget("quick"), searchCalls: 2 };
    const state = counters();
    const reservations = Array.from({ length: 5 }, () => tryReserveResearchBudgetCounter(state, limits, "searchCalls"));

    expect(reservations).toEqual([true, true, false, false, false]);
    expect(state.searchCalls).toBe(2);
  });

  it.each(["deep", "comprehensive"] as const)("reserves model, token and credit budget for %s finalization", (profile) => {
    const total = getResearchBudget(profile);
    const exploration = getResearchExplorationBudget(profile);
    const reserve = getResearchFinalizationReserve(profile);
    expect(total.modelCalls - exploration.modelCalls).toBe(reserve.modelCalls);
    expect(total.maxTokens - exploration.maxTokens).toBe(reserve.maxTokens);
    expect(total.maxCostCredits - exploration.maxCostCredits).toBe(reserve.maxCostCredits);
    expect(reserve.modelCalls).toBeGreaterThanOrEqual(5);
  });

  it("uses maxSources for source reservations and can release failed reads", () => {
    const limits = { ...getResearchBudget("quick"), maxSources: 1 };
    const state = counters();

    expect(tryReserveResearchBudgetCounter(state, limits, "sourceCount")).toBe(true);
    expect(tryReserveResearchBudgetCounter(state, limits, "sourceCount")).toBe(false);
    releaseResearchBudgetCounter(state, "sourceCount");
    expect(state.sourceCount).toBe(0);
    expect(tryReserveResearchBudgetCounter(state, limits, "sourceCount")).toBe(true);
  });
});
