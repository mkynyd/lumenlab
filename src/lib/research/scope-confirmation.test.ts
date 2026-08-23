import { describe, expect, it } from "vitest";
import {
  applyConfirmedScopeDirectives,
  assertBudgetExpansion,
  budgetProfileRank,
  isBudgetExpansion,
} from "./scope-confirmation";
import { buildResearchPlan } from "./plan";

describe("research scope confirmation", () => {
  it("only treats a higher profile as a budget expansion", () => {
    expect(isBudgetExpansion("quick", "deep")).toBe(true);
    expect(isBudgetExpansion("deep", "quick")).toBe(false);
    expect(budgetProfileRank("comprehensive")).toBeGreaterThan(budgetProfileRank("deep"));
    expect(() => assertBudgetExpansion("deep", "deep")).toThrow();
  });

  it("creates an immutable-plan successor with confirmed extra questions", () => {
    const original = buildResearchPlan({ question: "A", profile: "quick" });
    const next = applyConfirmedScopeDirectives(original, ["补充 B 的官方数据"], "deep");

    expect(original.researchQuestions).toHaveLength(1);
    expect(next.researchIntensity).toBe("deep");
    expect(next.researchQuestions).toHaveLength(2);
    expect(next.researchQuestions[1]).toMatchObject({ key: "q2", question: "补充 B 的官方数据" });
  });
});
