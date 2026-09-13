import { describe, expect, it } from "vitest";
import { applyResearchDirective, applyResearchPlannerDecision, buildResearchPlan, classifyResearchDirective } from "./plan";

describe("research plans", () => {
  it("creates public structured questions without hidden reasoning", () => {
    const plan = buildResearchPlan({ question: "比较 A 与 B？在 2024 年后的证据如何？", profile: "deep" });
    expect(plan.researchIntensity).toBe("deep");
    expect(plan.schemaVersion).toBe("2");
    expect(plan.originalRequest).toBe("比较 A 与 B？在 2024 年后的证据如何？");
    expect(plan.intentType).toBe("comparison");
    expect(plan.targetTimeRange).toBe("2024 年后");
    expect(plan.evidenceTimeRange).toMatch(/更早基线/);
    expect(plan.researchQuestions).toHaveLength(3);
    expect(plan.researchQuestions[0]).toMatchObject({ key: "q1", priority: "critical" });
  });

  it.each([
    ["窄事实", "Transformer 最初发表于哪一年？", "factual", 1, 2],
    ["比较", "比较 A 与 B 的准确率和成本", "comparison", 3, 3],
    ["趋势", "2025 年 MoE 路由方法的主要改进", "trend", 5, 5],
  ])("semantically decomposes %s research without over-expanding", (_label, question, intent, minimum, maximum) => {
    const plan = buildResearchPlan({ question, profile: "deep" });
    expect(plan.intentType).toBe(intent);
    expect(plan.researchQuestions.length).toBeGreaterThanOrEqual(minimum);
    expect(plan.researchQuestions.length).toBeLessThanOrEqual(maximum);
    if (question.includes("2025 年")) expect(plan.targetTimeRange).toBe("2025 年");
  });

  it("lets the planner replace deterministic questions while preserving the original request", () => {
    const plan = buildResearchPlan({ question: "2025 年 MoE 路由方法的主要改进", profile: "deep" });
    const revised = applyResearchPlannerDecision(plan, {
      objective: "判断 2025 年 MoE routing 的主要技术方向",
      questions: [{ key: "q7", question: "建立 routing taxonomy", title: "技术分类", priority: "critical" }],
    });
    expect(revised.originalRequest).toBe("2025 年 MoE 路由方法的主要改进");
    expect(revised.researchQuestions).toEqual([expect.objectContaining({ key: "q1", question: "建立 routing taxonomy" })]);
  });

  it("marks broadening directives for confirmation", () => {
    expect(classifyResearchDirective("扩大范围，覆盖全部年份")).toBe("scope_expansion");
    expect(classifyResearchDirective("增加模型调用预算")).toBe("budget_expansion");
    const plan = buildResearchPlan({ question: "A", profile: "quick" });
    expect(applyResearchDirective(plan, "补充 B 的官方数据").researchQuestions).toHaveLength(2);
  });
});
