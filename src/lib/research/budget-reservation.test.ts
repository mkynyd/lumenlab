import { describe, expect, it } from "vitest";
import { getResearchBudget, releaseResearchBudgetCounter, tryReserveResearchBudgetCounter, type ResearchBudgetCounters } from "./budget";

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
