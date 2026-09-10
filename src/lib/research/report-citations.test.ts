import { describe, expect, it } from "vitest";
import { buildResearchCitationMap, linkifyResearchEvidenceMarkers, researchEvidenceIdFromAnchor, researchEvidenceAnchor } from "./report-citations";

describe("research report citation markers", () => {
  it("links only evidence markers that exist in the frozen evidence order", () => {
    expect(linkifyResearchEvidenceMarkers("结论 [E1]，未知 [E3]。", ["ev-1", "ev-2"]))
      .toBe("结论 [E1](#research-evidence-ev-1)，未知 [E3]。");
  });

  it("does not double-link an existing marker", () => {
    expect(linkifyResearchEvidenceMarkers("[E1](#already-linked)", ["ev-1"]))
      .toBe("[E1](#already-linked)");
  });

  it("round-trips encoded evidence ids through report anchors", () => {
    const anchor = researchEvidenceAnchor("ev/with space");
    expect(researchEvidenceIdFromAnchor(anchor)).toBe("ev/with space");
    expect(researchEvidenceIdFromAnchor("#other-anchor")).toBeNull();
  });

  it("traces citations from evidence through snapshot to the canonical source", () => {
    const map = buildResearchCitationMap([{
      id: "claim-1",
      evidenceRelations: [
        {
          evidenceId: "ev-1",
          relation: "supports",
          evidence: {
            locator: { kind: "sciverse", docId: "doc-1", chunkId: "chunk-1", offset: 1200, pageNo: 3 },
            sourceSnapshotId: "snap-1",
            sourceSnapshot: {
              metadata: { provider: "sciverse", rawContentPersisted: true },
              source: { id: "src-1", kind: "academic_paper", title: "Attention Is All You Need", canonicalUrl: "https://arxiv.org/abs/1706.03762", doi: "10.48550/arxiv.1706.03762" },
            },
          },
        },
        {
          evidenceId: "ev-2",
          relation: "context",
          evidence: {
            locator: { kind: "url", url: "https://example.com/post" },
            sourceSnapshotId: "snap-2",
            sourceSnapshot: {
              metadata: { provider: "web" },
              source: { id: "src-2", kind: "web", title: "Blog post", canonicalUrl: "https://example.com/post", doi: null },
            },
          },
        },
      ],
    }]);

    const entries = map["claim-1"];
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      evidenceId: "ev-1",
      sourceSnapshotId: "snap-1",
      relation: "supports",
      locator: { kind: "sciverse", docId: "doc-1", chunkId: "chunk-1", offset: 1200 },
      source: { id: "src-1", kind: "academic_paper", title: "Attention Is All You Need", doi: "10.48550/arxiv.1706.03762", provider: "sciverse" },
    });
    // web 与 sciverse chunk 可通过 locator.kind 区分
    expect(entries[1].locator?.kind).toBe("url");
    expect(entries[1].source.provider).toBe("web");
  });
});
