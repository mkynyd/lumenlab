import { describe, expect, it } from "vitest";
import {
  buildResearchBibliography,
  buildResearchCitationMap,
  buildResearchReportMarkdown,
  linkifyResearchEvidenceMarkers,
  renderResearchBibliographyMarkdown,
  researchEvidenceIdFromAnchor,
  researchEvidenceAnchor,
  researchSourceKindLabel,
} from "./report-citations";

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

describe("research bibliography", () => {
  function evidenceInput(overrides: Record<string, unknown> = {}) {
    return {
      id: "ev-1",
      evidenceType: "direct_quote",
      sourceSnapshot: {
        sourceId: "src-1",
        metadata: { provider: "sciverse", scope: { type: "bounded_evidence_slices" } },
        source: {
          id: "src-1",
          kind: "academic_paper",
          title: "Attention Is All You Need",
          canonicalKey: "doi:10.48550/arxiv.1706.03762",
          canonicalUrl: "https://doi.org/10.48550/arxiv.1706.03762",
          doi: "10.48550/arxiv.1706.03762",
          metadata: { authors: ["Ashish Vaswani", "Noam Shazeer"], year: 2017, venue: "NeurIPS" },
        },
      },
      ...overrides,
    } as never;
  }

  it("deduplicates multiple chunks of the same canonical source", () => {
    const entries = buildResearchBibliography({
      evidence: [
        evidenceInput({ id: "ev-1" }),
        evidenceInput({ id: "ev-2" }),
      ],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      index: 1,
      sourceId: "src-1",
      authors: ["Ashish Vaswani", "Noam Shazeer"],
      year: 2017,
      venue: "NeurIPS",
      evidenceIds: ["ev-1", "ev-2"],
      evidenceScopes: ["full_text_chunk"],
    });
  });

  it("separates metadata-only, visual and graph-discovered provenance", () => {
    const entries = buildResearchBibliography({
      evidence: [
        evidenceInput({ id: "ev-1", sourceSnapshot: { ...(evidenceInput() as never as { sourceSnapshot: object }).sourceSnapshot, metadata: { provider: "sciverse", scope: { type: "metadata_only" } } } }),
        evidenceInput({ id: "ev-2", evidenceType: "visual_observation" }),
      ],
      relations: [{ sourceId: "seed", targetSourceId: "src-1", relation: "references" }],
    });
    const entry = entries[0];
    expect([...entry.evidenceScopes].sort()).toEqual(["metadata_only", "visual"]);
    expect(entry.hasVisualEvidence).toBe(true);
    expect(entry.graphDiscovered).toBe(true);
    expect(entry.graphRelations).toEqual(["references"]);
    expect(researchSourceKindLabel(entry.kind, entry)).toBe("引用关系发现 · 学术论文");
  });

  it("renders a numbered bibliography and marks scope caveats", () => {
    const entries = buildResearchBibliography({ evidence: [evidenceInput()] });
    const markdown = renderResearchBibliographyMarkdown(entries);
    expect(markdown).toContain("## 参考来源");
    expect(markdown).toContain("1. Ashish Vaswani, Noam Shazeer. 2017. Attention Is All You Need. NeurIPS");
    expect(markdown).toContain("DOI: 10.48550/arxiv.1706.03762");
    expect(markdown).not.toContain("仅摘要/元数据");
  });

  it("marks a metadata-only-only source explicitly", () => {
    const entries = buildResearchBibliography({
      evidence: [evidenceInput({ sourceSnapshot: { ...(evidenceInput() as never as { sourceSnapshot: object }).sourceSnapshot, metadata: { provider: "sciverse", scope: { type: "metadata_only" } } } })],
    });
    expect(renderResearchBibliographyMarkdown(entries)).toContain("仅摘要/元数据");
  });

  it("returns an empty bibliography block when nothing was persisted", () => {
    expect(renderResearchBibliographyMarkdown([])).toBe("");
  });

  it("exports markdown with the report body and the deduplicated sources", () => {
    const bibliography = buildResearchBibliography({ evidence: [evidenceInput()] });
    const markdown = buildResearchReportMarkdown({ title: "研究报告：注意力机制", body: "结论 [E1]。", bibliography });
    expect(markdown.startsWith("# 研究报告：注意力机制")).toBe(true);
    // Internal evidence markers must survive export unchanged.
    expect(markdown).toContain("结论 [E1]。");
    expect(markdown).toContain("## 参考来源");
  });
});

describe("citation map source metadata", () => {
  it("carries authors and year for the interactive citation card", () => {
    const map = buildResearchCitationMap([{
      id: "claim-1",
      evidenceRelations: [{
        evidenceId: "ev-1",
        relation: "supports",
        evidence: {
          locator: { kind: "sciverse", docId: "d" },
          sourceSnapshotId: "snap-1",
          sourceSnapshot: {
            metadata: { provider: "sciverse" },
            source: {
              id: "src-1",
              kind: "academic_paper",
              title: "T",
              canonicalUrl: null,
              doi: "10.1/x",
              metadata: { authors: ["A", "B"], year: 2024 },
            },
          },
        },
      }],
    }]);
    expect(map["claim-1"][0].source).toMatchObject({ authors: ["A", "B"], year: 2024, provider: "sciverse" });
  });

  it("deduplicates repeated evidence inside one claim without losing the relation", () => {
    const relation = {
      evidenceId: "ev-1",
      relation: "contradicts",
      evidence: {
        locator: null,
        sourceSnapshotId: "snap-1",
        sourceSnapshot: {
          metadata: {},
          source: { id: "src-1", kind: "web", title: "T", canonicalUrl: null, doi: null },
        },
      },
    };
    const map = buildResearchCitationMap([{ id: "claim-1", evidenceRelations: [relation, relation] }]);
    expect(map["claim-1"]).toHaveLength(1);
    expect(map["claim-1"][0].relation).toBe("contradicts");
  });
});
