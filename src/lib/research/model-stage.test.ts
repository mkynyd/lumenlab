import { describe, expect, it } from "vitest";
import { normalizeResearchEvaluatorDecision, normalizeResearchVerifierDecision, normalizeResearchWorkerDecision, parseStructuredJson } from "./model-stage";

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
});
