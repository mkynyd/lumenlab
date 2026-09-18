import { describe, expect, it } from "vitest";
import { canProduceFullTextEvidence, prioritizeResearchCandidates, selectCandidatesForTriage, TRIAGE_WEB_FLOOR, TRIAGE_WINDOW_SIZE } from "./candidate-priority";
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

describe("selectCandidatesForTriage · provider-family fairness window", () => {
  const RANK = ["project", "sciverse", "openalex", "crossref", "arxiv", "web"];

  function candidatesOf(shape: Record<string, number>): ResearchCandidate[] {
    const list: ResearchCandidate[] = [];
    for (const [provider, count] of Object.entries(shape)) {
      for (let index = 0; index < count; index += 1) {
        list.push(candidate({ provider, externalId: `${provider}-${index}`, metadata: provider === "sciverse" ? { docId: "d".repeat(64) } : {} }));
      }
    }
    return list;
  }

  it("keeps the historical behavior when the window is not full", () => {
    const { selected, droppedByProvider } = selectCandidatesForTriage(candidatesOf({ sciverse: 8, web: 3 }), RANK);
    expect(selected).toHaveLength(11);
    expect(droppedByProvider).toEqual({});
  });

  it("guarantees web floor when project + sciverse fill the page (production incident shape)", () => {
    // project 3 + sciverse 10 = 13 > 12：旧 slice 会把 web 全量挤出。
    const { selected, droppedByProvider } = selectCandidatesForTriage(candidatesOf({ project: 3, sciverse: 10, web: 5 }), RANK);
    expect(selected).toHaveLength(TRIAGE_WINDOW_SIZE);
    const webSelected = selected.filter((item) => item.provider === "web");
    expect(webSelected).toHaveLength(TRIAGE_WEB_FLOOR);
    // web 保底拿的是优先级最高的 web 候选。
    expect(webSelected.map((item) => item.externalId)).toEqual(["web-0", "web-1", "web-2"]);
    // 被淘汰者按 provider 计数：保底占 3 席后填充 9 席（project 3 + sciverse 6），
    // 落选 = 4 个最低优先级 sciverse + 2 个保底之外的 web。
    expect(droppedByProvider).toEqual({ web: 2, sciverse: 4 });
  });

  it("caps the web floor at the actual web count", () => {
    const { selected } = selectCandidatesForTriage(candidatesOf({ project: 3, sciverse: 10, web: 2 }), RANK);
    expect(selected.filter((item) => item.provider === "web")).toHaveLength(2);
  });

  it("does not duplicate web candidates when they also rank high", () => {
    // web 排在第一位时，保底与填充不得重复入选。
    const { selected } = selectCandidatesForTriage(candidatesOf({ web: 5, sciverse: 10 }), ["web", "sciverse"]);
    expect(selected).toHaveLength(TRIAGE_WINDOW_SIZE);
    expect(new Set(selected).size).toBe(selected.length);
    expect(selected.filter((item) => item.provider === "web")).toHaveLength(5);
  });

  it("is deterministic for identical inputs", () => {
    const input = candidatesOf({ project: 3, sciverse: 10, web: 5 });
    const first = selectCandidatesForTriage(input, RANK);
    const second = selectCandidatesForTriage(input, RANK);
    expect(first.selected.map((item) => item.externalId)).toEqual(second.selected.map((item) => item.externalId));
    expect(first.droppedByProvider).toEqual(second.droppedByProvider);
  });
});
