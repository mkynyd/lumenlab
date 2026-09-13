import { describe, expect, it } from "vitest";
import { deterministicEvaluatorDecision } from "./evaluator";

describe("deterministic evaluator floor", () => {
  it("does not resolve a trend question from two irrelevant evidence records", () => {
    const result = deterministicEvaluatorDecision({
      intentType: "trend",
      evidence: [
        { sourceRelevance: "irrelevant", sourceRole: "context", scope: "full_text_chunk", canonicalSourceIdentity: "health-guideline" },
        { sourceRelevance: "irrelevant", sourceRole: "context", scope: "full_text_chunk", canonicalSourceIdentity: "nutrition-paper" },
      ],
    });
    expect(result).toMatchObject({ status: "unresolved", independentSourceCount: 0, primaryEvidencePresent: false });
  });

  it("requires three independent direct sources for analytical intents", () => {
    const evidence = ["a", "b"].map((id) => ({ sourceRelevance: "direct", sourceRole: "primary", scope: "full_text_chunk", canonicalSourceIdentity: id }));
    expect(deterministicEvaluatorDecision({ intentType: "technical_review", evidence }).status).toBe("partially_resolved");
    expect(deterministicEvaluatorDecision({ intentType: "technical_review", evidence: [...evidence, { ...evidence[0], canonicalSourceIdentity: "c" }] }).status).toBe("resolved");
  });
});
