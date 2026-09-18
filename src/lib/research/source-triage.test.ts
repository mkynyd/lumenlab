import { describe, expect, it } from "vitest";
import type { ResearchQueryStrategyItem } from "./model-stage";
import type { ResearchCandidate } from "./source-provider";
import { assessSourceQuality, deterministicSourceAssessment, normalizeSourceTriageDecision } from "./source-triage";

const strategy: ResearchQueryStrategyItem = { query: "MoE routing 2025", purpose: "primary_work", sourceRole: "primary", freshness: "target_period", questionKey: "q1" };
function candidate(title: string, venue = "EMNLP"): ResearchCandidate {
  return { provider: "sciverse", kind: "academic_paper", externalId: title, title, url: null, metadata: { venue, year: 2025 } };
}

describe("source relevance and quality are independent", () => {
  const question = "2025 年 MoE 路由方法的主要改进";
  it.each([
    "European Association of Urology Guidelines on Male Sexual and Reproductive Health 2025",
    "Goals in Nutrition Science 2020–2025",
  ])("rejects the real domain-mismatch regression: %s", (title) => {
    expect(deterministicSourceAssessment({ question, strategy, candidate: candidate(title) }).relevance).toBe("irrelevant");
  });

  it("keeps recommendation and serving papers adjacent instead of core routing evidence", () => {
    expect(deterministicSourceAssessment({ question, strategy, candidate: candidate("Hierarchical Time-Aware Mixture of Experts for Multi-Modal Sequential Recommendation") }).relevance).toBe("adjacent");
    expect(deterministicSourceAssessment({ question, strategy, candidate: candidate("MegaScale-Infer: Efficient Mixture-of-Experts Model Serving") }).relevance).toBe("adjacent");
  });

  it("keeps a direct primary routing paper", () => {
    expect(deterministicSourceAssessment({ question, strategy, candidate: candidate("Stable Expert Routing and Load Balancing for Mixture-of-Experts Models", "EMNLP") }).relevance).toBe("direct");
  });

  it("does not mistake working-paper quality for relevance", () => {
    const working = { ...candidate("Adaptive Router Selection in Mixture-of-Experts"), url: "https://ssrn.com/abstract=1", metadata: { venue: "SSRN", year: 2025 } };
    const assessment = deterministicSourceAssessment({ question, strategy, candidate: working });
    expect(assessment.relevance).toBe("direct");
    expect(assessSourceQuality(working)).toBe("grey_literature");
  });
});

describe("normalizeSourceTriageDecision qualityClass 兼容", () => {
  it("keeps relevance judgment when model emits out-of-enum qualityClass", () => {
    const normalized = normalizeSourceTriageDecision({
      candidates: [
        { id: "0", relevance: "direct", sourceRole: "primary", qualityClass: "high", relevanceScore: 0.9, reason: "官方发布" },
        { id: "1", relevance: "irrelevant", sourceRole: "context", qualityClass: "unknown", reason: "不相关" },
        { id: "2", relevance: "adjacent", sourceRole: "secondary", qualityClass: "official_document" },
      ],
    }, new Set(["0", "1", "2"]));
    expect(normalized["0"].relevance).toBe("direct");
    expect(normalized["0"].qualityClass).toBe("primary_peer_reviewed");
    expect(normalized["1"].relevance).toBe("irrelevant");
    expect(normalized["2"].qualityClass).toBe("official_standard");
  });
});
