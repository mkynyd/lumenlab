import { describe, expect, it } from "vitest";
import {
  buildClaimExtractionPrompt,
  buildClaimKey,
  buildQuestionEvidenceFingerprint,
  CLAIM_EXTRACTOR_VERSION,
  MAX_CLAIMS_PER_QUESTION,
  normalizeClaimExtractorOutput,
  normalizeClaimSemanticKey,
} from "./claim-extraction";

const VALID = new Set(["ev-1", "ev-2", "ev-3"]);

describe("claim extraction · evidence fingerprint", () => {
  it("is deterministic and order-independent", () => {
    const a = buildQuestionEvidenceFingerprint([{ id: "ev-1", status: "active" }, { id: "ev-2", status: "active" }]);
    const b = buildQuestionEvidenceFingerprint([{ id: "ev-2", status: "active" }, { id: "ev-1", status: "active" }]);
    expect(a).toBe(b);
  });

  it("changes when evidence set or status changes", () => {
    const base = buildQuestionEvidenceFingerprint([{ id: "ev-1", status: "active" }]);
    expect(buildQuestionEvidenceFingerprint([{ id: "ev-1", status: "active" }, { id: "ev-2", status: "active" }])).not.toBe(base);
    expect(buildQuestionEvidenceFingerprint([{ id: "ev-1", status: "invalidated" }])).not.toBe(base);
    expect(buildQuestionEvidenceFingerprint([])).not.toBe(base);
  });
});

describe("claim extraction · semantic key and claimKey", () => {
  it("normalizes model keys into bounded slugs", () => {
    expect(normalizeClaimSemanticKey("Self Attention Removes Recurrence!", "s")).toBe("self-attention-removes-recurrence");
    expect(normalizeClaimSemanticKey(`x${"a".repeat(80)}`, "s")).toHaveLength(48);
  });

  it("falls back to a statement hash for missing or unusable keys", () => {
    const key = normalizeClaimSemanticKey("！！！", "Transformer 使用自注意力");
    expect(key).toMatch(/^c-[0-9a-f]{12}$/);
    expect(normalizeClaimSemanticKey(undefined, "Transformer 使用自注意力")).toBe(key);
  });

  it("builds deterministic, versioned claim keys", () => {
    expect(buildClaimKey("q1", "self-attention")).toBe(`${CLAIM_EXTRACTOR_VERSION}:q1:self-attention`);
  });
});

describe("claim extraction · output normalization", () => {
  it("keeps multiple atomic claims with valid relations", () => {
    const decision = normalizeClaimExtractorOutput({
      claims: [
        { key: "claim-a", statement: "命题 A", relations: [{ evidenceId: "ev-1", relation: "supports", confidence: 0.9, rationale: "直接陈述" }] },
        { key: "claim-b", statement: "命题 B", relations: [{ evidenceId: "ev-2", relation: "qualifies", confidence: 0.5 }] },
      ],
    }, VALID);
    expect(decision.claims).toHaveLength(2);
    expect(decision.claims[0]).toMatchObject({ key: "claim-a", statement: "命题 A" });
    expect(decision.claims[1].relations[0]).toMatchObject({ relation: "qualifies", confidence: 0.5, rationale: null });
  });

  it("allows zero claims when evidence is insufficient", () => {
    expect(normalizeClaimExtractorOutput({ claims: [] }, VALID).claims).toEqual([]);
    expect(normalizeClaimExtractorOutput(null, VALID).claims).toEqual([]);
    expect(normalizeClaimExtractorOutput({ claims: [{ key: "x", statement: "  " }] }, VALID).claims).toEqual([]);
  });

  it("drops relations referencing unknown evidence IDs", () => {
    const decision = normalizeClaimExtractorOutput({
      claims: [{ key: "a", statement: "命题", relations: [
        { evidenceId: "ev-unknown", relation: "supports", confidence: 0.9 },
        { evidenceId: "ev-1", relation: "supports", confidence: 0.8 },
      ] }],
    }, VALID);
    expect(decision.claims[0].relations).toHaveLength(1);
    expect(decision.claims[0].relations[0].evidenceId).toBe("ev-1");
  });

  it("rejects illegal relations, non-finite confidence and duplicate relations", () => {
    const decision = normalizeClaimExtractorOutput({
      claims: [{ key: "a", statement: "命题", relations: [
        { evidenceId: "ev-1", relation: "proves", confidence: 0.9 },
        { evidenceId: "ev-2", relation: "supports", confidence: Number.NaN },
        { evidenceId: "ev-3", relation: "supports", confidence: Number.POSITIVE_INFINITY },
        { evidenceId: "ev-1", relation: "supports", confidence: 0.7 },
        { evidenceId: "ev-1", relation: "contradicts", confidence: 0.6 },
      ] }],
    }, VALID);
    expect(decision.claims[0].relations).toHaveLength(1);
    expect(decision.claims[0].relations[0]).toMatchObject({ evidenceId: "ev-1", relation: "supports", confidence: 0.7 });
  });

  it("clamps confidence into [0, 1] and bounds field lengths", () => {
    const decision = normalizeClaimExtractorOutput({
      claims: [{ key: "a", statement: `长${"句".repeat(800)}`, qualifiers: [`q${"长".repeat(400)}`], relations: [
        { evidenceId: "ev-1", relation: "supports", confidence: 7, rationale: `r${"长".repeat(600)}` },
      ] }],
    }, VALID);
    expect(decision.claims[0].statement.length).toBeLessThanOrEqual(600);
    expect(decision.claims[0].qualifiers[0].length).toBeLessThanOrEqual(240);
    expect(decision.claims[0].relations[0].confidence).toBe(1);
    expect(decision.claims[0].relations[0].rationale!.length).toBeLessThanOrEqual(400);
  });

  it("caps the number of claims per question", () => {
    const decision = normalizeClaimExtractorOutput({
      claims: Array.from({ length: 10 }, (_, index) => ({ key: `k${index}`, statement: `命题 ${index}`, relations: [] })),
    }, VALID);
    expect(decision.claims).toHaveLength(MAX_CLAIMS_PER_QUESTION);
  });

  it("deduplicates identical semantic keys", () => {
    const decision = normalizeClaimExtractorOutput({
      claims: [
        { key: "same-key", statement: "命题 A", relations: [] },
        { key: "same-key", statement: "命题 B", relations: [] },
      ],
    }, VALID);
    expect(decision.claims).toHaveLength(1);
  });
});

describe("claim extraction · prompt", () => {
  it("lists only the provided evidence and forbids fabrication", () => {
    const prompt = buildClaimExtractionPrompt({
      question: { key: "q1", title: "标题", question: "问题", completionCriteria: ["标准"] },
      domainProfile: { name: "cs" },
      evidence: [{
        id: "ev-1",
        statement: "陈述",
        excerpt: "摘录",
        evidenceType: "direct_quote",
        locator: { kind: "sciverse", docId: "d", chunkId: "c", offset: 10 },
        provenance: { provider: "sciverse" },
        source: { canonicalKey: "doi:10.1/x", title: "Paper", kind: "academic_paper", provider: "sciverse", doi: "10.1/x", canonicalUrl: "https://doi.org/10.1/x" },
      }],
    });
    expect(prompt).toContain("ev-1");
    expect(prompt).toContain("捏造");
    expect(prompt).toContain("supports");
    expect(prompt).toContain("context=仅提供背景");
    expect(prompt).not.toContain("ev-2");
  });

  it("explicitly handles questions without evidence", () => {
    const prompt = buildClaimExtractionPrompt({
      question: { key: "q1", title: "t", question: "q", completionCriteria: [] },
      evidence: [],
    });
    expect(prompt).toContain("应返回空 claims");
  });
});
