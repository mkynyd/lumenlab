import { describe, expect, it } from "vitest";
import { applyResearchDirective, buildResearchPlan, classifyResearchDirective } from "./plan";

describe("research plans", () => {
  it("creates public structured questions without hidden reasoning", () => {
    const plan = buildResearchPlan({ question: "比较 A 与 B？在 2024 年后的证据如何？", profile: "deep" });
    expect(plan.researchIntensity).toBe("deep");
    expect(plan.researchQuestions).toHaveLength(2);
    expect(plan.researchQuestions[0]).toMatchObject({ key: "q1", priority: "critical" });
  });

  it("marks broadening directives for confirmation", () => {
    expect(classifyResearchDirective("扩大范围，覆盖全部年份")).toBe("scope_expansion");
    const plan = buildResearchPlan({ question: "A", profile: "quick" });
    expect(applyResearchDirective(plan, "补充 B 的官方数据").researchQuestions).toHaveLength(2);
  });
});
