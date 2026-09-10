// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildResearchProgressSummary,
  buildResearchSourceViews,
  formatResearchElapsed,
  researchGraphProvenanceLabel,
  researchQuestionCompletion,
  researchRelationLabel,
  researchSourceBadges,
  researchSourceKindLabel,
  researchVerificationLabel,
  researchVerificationTone,
} from "./research-view-model";

describe("research relation and verification labels", () => {
  it("labels claim↔evidence and citation-graph relations distinctly", () => {
    expect(researchRelationLabel("supports")).toBe("支持");
    expect(researchRelationLabel("contradicts")).toBe("反驳");
    expect(researchRelationLabel("qualifies")).toBe("限定");
    expect(researchRelationLabel("context")).toBe("背景");
    expect(researchRelationLabel("references")).toBe("引用");
    expect(researchRelationLabel("citations")).toBe("被引用");
    expect(researchRelationLabel("related_work")).toBe("相关工作");
  });

  it("distinguishes all four verification statuses instead of collapsing them", () => {
    const labels = ["verified", "needs_qualification", "conflicted", "unsupported"].map(researchVerificationLabel);
    expect(new Set(labels).size).toBe(4);
    expect(researchVerificationTone("verified")).toBe("positive");
    expect(researchVerificationTone("needs_qualification")).toBe("caution");
    expect(researchVerificationTone("conflicted")).toBe("caution");
    expect(researchVerificationTone("unsupported")).toBe("neutral");
  });

  it("keeps question progress bounded to 0-100", () => {
    for (const status of ["pending", "researching", "evaluating", "partially_resolved", "controversial", "resolved", "unknown"]) {
      const value = researchQuestionCompletion(status);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });
});

describe("elapsed time formatting", () => {
  it("formats an idle run from its start time", () => {
    const start = new Date("2026-01-01T00:00:00.000Z").toISOString();
    const now = Date.parse(start) + 125_000;
    expect(formatResearchElapsed(start, null, now)).toBe("2 分 05 秒");
  });

  it("uses the completion time once the run is finished", () => {
    const start = new Date("2026-01-01T00:00:00.000Z").toISOString();
    const end = new Date("2026-01-01T01:15:00.000Z").toISOString();
    expect(formatResearchElapsed(start, end, Date.parse(end) + 600_000)).toBe("1 小时 15 分");
  });

  it("returns null when there is no usable start time", () => {
    expect(formatResearchElapsed(null, null, 0)).toBeNull();
    expect(formatResearchElapsed("not-a-date", null, 0)).toBeNull();
  });
});

describe("bounded progress summary", () => {
  it("counts from persisted facts without inventing values", () => {
    const summary = buildResearchProgressSummary({
      questions: [{ status: "resolved" }, { status: "unresolved" }],
      tasks: [{ status: "running" }, { status: "completed" }],
      sourceCount: 7,
      evidenceCount: 12,
      claimCount: 4,
      graphMetrics: { sourcesFetched: 3, edgesDiscovered: 9 },
      visualMetrics: { observationsPersisted: 2 },
      metrics: { searchCalls: 11, fetchCalls: 13, modelCalls: 6, degradations: ["arxiv_error"] },
    });
    expect(summary).toEqual({
      questionTotal: 2,
      questionsResolved: 1,
      activeTasks: 1,
      sourceCount: 7,
      evidenceCount: 12,
      claimCount: 4,
      citationExpansionSources: 3,
      citationExpansionEdges: 9,
      visualObservations: 2,
      searchCalls: 11,
      fetchCalls: 13,
      modelCalls: 6,
      providerDegradation: true,
    });
  });

  it("degrades to zeros when metrics are missing", () => {
    const summary = buildResearchProgressSummary({ questions: [], tasks: [], sourceCount: 0, evidenceCount: 0, claimCount: 0 });
    expect(Object.values(summary).every((value) => value === 0 || value === false)).toBe(true);
  });
});

describe("source list classification", () => {
  function evidence(overrides: Record<string, unknown> = {}) {
    return {
      id: "ev-1",
      evidenceType: "direct_quote",
      sourceSnapshot: {
        sourceId: "src-1",
        metadata: { scope: { type: "bounded_evidence_slices" } },
        source: {
          id: "src-1",
          kind: "academic_paper",
          title: "Attention Is All You Need",
          canonicalKey: "doi:10.1/x",
          canonicalUrl: "https://doi.org/10.1/x",
          doi: "10.1/x",
          metadata: { authors: ["Vaswani"], year: 2017, venue: "NeurIPS" },
        },
      },
      ...overrides,
    } as never;
  }

  it("merges chunks of the same canonical source and keeps provenance", () => {
    const views = buildResearchSourceViews({
      evidence: [evidence({ id: "ev-1" }), evidence({ id: "ev-2" })],
      relations: [{ sourceId: "seed", targetSourceId: "src-1", relation: "references" }],
    });
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({
      title: "Attention Is All You Need",
      authors: ["Vaswani"],
      year: 2017,
      venue: "NeurIPS",
      isGraphDiscovered: true,
      graphRelations: ["references"],
      hasFullTextEvidence: true,
      hasMetadataOnlyEvidence: false,
      hasVisualEvidence: false,
      evidenceCount: 2,
    });
  });

  it("marks metadata-only and visual evidence explicitly", () => {
    const views = buildResearchSourceViews({
      evidence: [
        evidence({ id: "ev-1", sourceSnapshot: { ...(evidence() as never as { sourceSnapshot: object }).sourceSnapshot, metadata: { scope: { type: "metadata_only" } } } }),
        evidence({ id: "ev-2", evidenceType: "visual_observation" }),
      ],
    });
    expect(views[0].hasMetadataOnlyEvidence).toBe(true);
    expect(views[0].hasVisualEvidence).toBe(true);
    const badges = researchSourceBadges(views[0]).map((badge) => badge.label);
    expect(badges).toContain("仅摘要/元数据");
    expect(badges).toContain("图表观察");
    expect(badges).toContain("学术论文");
  });

  it("skips evidence whose source is missing instead of inventing one", () => {
    expect(buildResearchSourceViews({ evidence: [{ id: "ev-1", evidenceType: "direct_quote", sourceSnapshot: null }] })).toEqual([]);
  });

  it("labels source kinds and graph provenance for the UI", () => {
    expect(researchSourceKindLabel("web")).toBe("网页");
    expect(researchSourceKindLabel("project_file")).toBe("项目资料");
    expect(researchSourceKindLabel("mystery")).toBe("来源");
    expect(researchGraphProvenanceLabel("citations")).toContain("后续研究");
  });
});
