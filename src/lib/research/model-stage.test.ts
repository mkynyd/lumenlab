import { describe, expect, it } from "vitest";
import { normalizeResearchEvaluatorDecision, normalizeResearchPlannerDecision, normalizeResearchVerifierDecision, normalizeResearchWorkerDecision, parseStructuredJson } from "./model-stage";
import { applyResearchPlannerDecision, buildResearchPlan } from "./plan";

describe("research model stage contracts", () => {
  it("extracts bounded JSON from a fenced model response", () => {
    expect(parseStructuredJson<{ queries: string[] }>("说明\n```json\n{\"queries\":[\"a\"]}\n```"))
      .toEqual({ queries: ["a"] });
  });

  it("falls back to the question when a worker response is unusable", () => {
    expect(normalizeResearchWorkerDecision({ queries: ["  query  ", "", 1], rationale: "x" }, "fallback"))
      .toEqual({ queries: ["query"], rationale: "x" });
    expect(normalizeResearchWorkerDecision(null, "fallback").queries).toEqual(["fallback"]);
  });

  it("keeps evaluator values inside the public quality contract", () => {
    expect(normalizeResearchEvaluatorDecision({ status: "controversial", coverage: 4, directness: -1, followUpQueries: ["补充"] }, {
      status: "unresolved", coverage: 0, directness: 0,
    })).toEqual({ status: "controversial", coverage: 1, directness: 0, gap: undefined, followUpQueries: ["补充"] });
  });

  it("drops verifier claims with unknown statuses", () => {
    expect(normalizeResearchVerifierDecision({ claims: { a: { status: "verified", reasonCode: "direct" }, b: { status: "unknown" } } }))
      .toEqual({ claims: { a: { status: "verified", reasonCode: "direct" } } });
  });

  it("bounds planner output and applies only known question keys", () => {
    const decision = normalizeResearchPlannerDecision({
      scope: "  更具体的范围 ",
      timeRange: null,
      sourceStrategy: ["官方资料", "原始研究"],
      questions: [{ key: "q1", priority: "critical", question: "修订后的问题" }, { key: "q99", question: "不得写入" }],
    });
    const plan = applyResearchPlannerDecision(buildResearchPlan({ question: "原问题", profile: "deep" }), decision);
    expect(plan.scope).toBe("更具体的范围");
    expect(plan.researchQuestions[0].question).toBe("修订后的问题");
    expect(plan.researchQuestions.some((item) => item.question === "不得写入")).toBe(false);
  });
});
