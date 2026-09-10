import { describe, expect, it } from "vitest";
import { canProduceFullTextEvidence, prioritizeResearchCandidates } from "./candidate-priority";
import type { ResearchCandidate } from "./source-provider";

function candidate(overrides: Partial<ResearchCandidate> & { provider: string }): ResearchCandidate {
  return {
    kind: "academic_paper",
    externalId: `${overrides.provider}:${Math.random().toString(36).slice(2, 8)}`,
    title: "paper",
    url: null,
    metadata: {},
    ...overrides,
  };
}

describe("research candidate priority", () => {
  it("orders by domain profile provider rank and keeps unlisted providers last", () => {
    const candidates = [
      candidate({ provider: "web" }),
      candidate({ provider: "sciverse", metadata: { isContentAccessible: true } }),
      candidate({ provider: "openalex" }),
      candidate({ provider: "project", kind: "project_file" }),
    ];
    const sorted = prioritizeResearchCandidates(candidates, ["project", "sciverse", "openalex", "crossref", "arxiv", "web"]);
    expect(sorted.map((item) => item.provider)).toEqual(["project", "sciverse", "openalex", "web"]);
  });

  it("is not an allowlist: providers absent from preferredProviders are retained", () => {
    const candidates = [candidate({ provider: "pubmed", kind: "pmid" }), candidate({ provider: "arxiv", kind: "arxiv" })];
    const sorted = prioritizeResearchCandidates(candidates, ["sciverse"]);
    expect(sorted).toHaveLength(2);
    // arxiv 可读全文，在同为 unlisted 的情况下排在 metadata-only 的 pubmed 之前。
    expect(sorted.map((item) => item.provider)).toEqual(["arxiv", "pubmed"]);
  });

  it("works without preferredProviders (readability/identity only)", () => {
    const sorted = prioritizeResearchCandidates(
      [candidate({ provider: "openalex" }), candidate({ provider: "web", kind: "web" })],
      undefined,
    );
    expect(sorted.map((item) => item.provider)).toEqual(["web", "openalex"]);
  });

  it("prefers sciverse papers with a doc_id over metadata-only ones at the same rank", () => {
    const metadataOnly = candidate({ provider: "sciverse", metadata: { docId: null, isContentAccessible: false, citationCount: 999999 } });
    const accessible = candidate({ provider: "sciverse", metadata: { docId: "a".repeat(64), citationCount: 1 } });
    const sorted = prioritizeResearchCandidates([metadataOnly, accessible], ["sciverse"]);
    // citationCount 不主导 fetch 顺序：可访问全文者优先。
    expect(sorted[0]).toBe(accessible);
    expect(sorted[1]).toBe(metadataOnly);
  });

  it("keeps metadata-only candidates (not rejected) and prefers DOI identity", () => {
    const noDoi = candidate({ provider: "openalex", metadata: {} });
    const withDoi = candidate({ provider: "openalex", metadata: { doi: "10.1000/x" } });
    const sorted = prioritizeResearchCandidates([noDoi, withDoi], ["openalex"]);
    expect(sorted[0]).toBe(withDoi);
    expect(sorted).toHaveLength(2);
  });

  it("uses metadata completeness as a final small signal", () => {
    const sparse = candidate({ provider: "crossref", metadata: { doi: "10.1/a" } });
    const rich = candidate({ provider: "crossref", metadata: { doi: "10.1/b", authors: ["A"], year: 2024, venue: "NeurIPS" } });
    const sorted = prioritizeResearchCandidates([sparse, rich], ["crossref"]);
    expect(sorted[0]).toBe(rich);
  });

  it("is stable for equal-priority candidates", () => {
    const first = candidate({ provider: "web", kind: "web", externalId: "a" });
    const second = candidate({ provider: "web", kind: "web", externalId: "b" });
    const sorted = prioritizeResearchCandidates([first, second], ["web"]);
    expect(sorted[0]).toBe(first);
    expect(sorted[1]).toBe(second);
  });

  it("classifies full-text capability by provider", () => {
    // doc_id 是全文 artifact 哈希：存在即代表可尝试有界正文读取。
    expect(canProduceFullTextEvidence(candidate({ provider: "sciverse", metadata: { docId: "a".repeat(64) } }))).toBe(true);
    expect(canProduceFullTextEvidence(candidate({ provider: "sciverse", metadata: { docId: null } }))).toBe(false);
    // 生产实测 is_content_accessible 恒为 false，但仍作为兼容信号保留。
    expect(canProduceFullTextEvidence(candidate({ provider: "sciverse", metadata: { docId: null, isContentAccessible: true } }))).toBe(true);
    expect(canProduceFullTextEvidence(candidate({ provider: "arxiv", kind: "arxiv" }))).toBe(true);
    expect(canProduceFullTextEvidence(candidate({ provider: "openalex" }))).toBe(false);
    expect(canProduceFullTextEvidence(candidate({ provider: "pubmed", kind: "pmid" }))).toBe(false);
  });
});
