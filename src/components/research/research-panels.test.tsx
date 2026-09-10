import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ResearchSourcesPanel } from "./research-sources-panel";
import { ResearchReportEvidencePanel } from "./research-report-evidence-panel";
import { buildResearchSourceViews } from "@/lib/research/research-view-model";

function evidence(overrides: Record<string, unknown> = {}) {
  return {
    id: "ev-1",
    evidenceType: "direct_quote",
    statement: "MoE routing improves throughput.",
    excerpt: "MoE routing improves throughput by 1.8x.",
    locator: { kind: "sciverse", docId: "d".repeat(64), offset: 120 },
    status: "active",
    tags: [],
    sourceSnapshot: {
      id: "snap-1",
      sourceId: "src-1",
      retrievedAt: "2026-01-01T00:00:00.000Z",
      metadata: { scope: { type: "bounded_evidence_slices" } },
      source: {
        id: "src-1",
        kind: "academic_paper",
        title: "Sparse routing at scale",
        canonicalKey: "doi:10.1/x",
        canonicalUrl: "https://doi.org/10.1/x",
        doi: "10.1/x",
        metadata: { authors: ["Jane Doe", "John Roe"], year: 2024, venue: "NeurIPS" },
      },
    },
    ...overrides,
  } as never;
}

describe("ResearchSourcesPanel", () => {
  it("distinguishes web, scholarly, project, graph-discovered, metadata-only and visual sources", () => {
    const sources = buildResearchSourceViews({
      evidence: [
        evidence({ id: "ev-1" }),
        evidence({
          id: "ev-2",
          evidenceType: "visual_observation",
          sourceSnapshot: {
            sourceId: "src-2",
            metadata: { scope: { type: "bounded_evidence_slices" } },
            source: { id: "src-2", kind: "academic_paper", title: "Figure-rich paper", canonicalKey: "doi:10.2/y", canonicalUrl: null, doi: "10.2/y", metadata: {} },
          },
        }),
        evidence({
          id: "ev-4",
          sourceSnapshot: {
            sourceId: "src-4",
            metadata: { scope: { type: "metadata_only" } },
            source: { id: "src-4", kind: "academic_paper", title: "Metadata only paper", canonicalKey: "doi:10.4/w", canonicalUrl: null, doi: "10.4/w", metadata: {} },
          },
        }),
        evidence({
          id: "ev-3",
          sourceSnapshot: {
            sourceId: "src-3",
            metadata: { scope: { type: "bounded_excerpt" } },
            source: { id: "src-3", kind: "web", title: "Official blog", canonicalKey: "url:https://example.test", canonicalUrl: "https://example.test", doi: null, metadata: {} },
          },
        }),
      ],
      relations: [{ sourceId: "src-1", targetSourceId: "src-2", relation: "citations" }],
    });

    render(<ResearchSourcesPanel sources={sources} selectedSourceId={null} onSelectSource={() => undefined} />);

    expect(screen.getByText("Sparse routing at scale")).toBeInTheDocument();
    expect(screen.getByText("Metadata only paper")).toBeInTheDocument();
    expect(screen.getByText("Figure-rich paper")).toBeInTheDocument();
    expect(screen.getByText("Official blog")).toBeInTheDocument();
    expect(screen.getAllByText("学术论文")).toHaveLength(3);
    expect(screen.getByText("网页")).toBeInTheDocument();
    expect(screen.getByText("由引用关系发现")).toBeInTheDocument();
    expect(screen.getByText("仅摘要/元数据")).toBeInTheDocument();
    expect(screen.getByText("图表观察")).toBeInTheDocument();
    expect(screen.getAllByText("全文片段").length).toBeGreaterThan(0);
    expect(screen.getByText("4 个独立来源（按论文/页面归并）")).toBeInTheDocument();
  });

  it("shows graph provenance in the selected source detail", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const sources = buildResearchSourceViews({
      evidence: [evidence()],
      relations: [{ sourceId: "seed", targetSourceId: "src-1", relation: "references" }],
    });
    const { rerender } = render(<ResearchSourcesPanel sources={sources} selectedSourceId={null} onSelectSource={onSelect} />);
    await user.click(screen.getByRole("button", { name: /Sparse routing at scale/ }));
    expect(onSelect).toHaveBeenCalledWith("src-1");

    rerender(<ResearchSourcesPanel sources={sources} selectedSourceId="src-1" onSelectSource={onSelect} />);
    expect(screen.getByText(/发现方式：引用（它引用的原始工作）/)).toBeInTheDocument();
    expect(screen.getByText(/作者：Jane Doe, John Roe/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /打开来源/ })).toHaveAttribute("href", "https://doi.org/10.1/x");
  });

  it("renders an explicit empty state", () => {
    render(<ResearchSourcesPanel sources={[]} selectedSourceId={null} onSelectSource={() => undefined} />);
    expect(screen.getByText("当前 Run 还没有已读取的来源。")).toBeInTheDocument();
  });

  it("exposes aria-pressed on source buttons for keyboard and screen readers", () => {
    const sources = buildResearchSourceViews({ evidence: [evidence()] });
    render(<ResearchSourcesPanel sources={sources} selectedSourceId="src-1" onSelectSource={() => undefined} />);
    expect(screen.getByRole("button", { name: /Sparse routing at scale/ })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("ResearchReportEvidencePanel citation interaction", () => {
  const claims = [
    {
      id: "claim-1",
      statement: "Sparse routing raises throughput.",
      verificationStatus: "verified",
      evidenceRelations: [{ relation: "supports", evidence: { id: "ev-1", statement: "MoE", status: "active", sourceSnapshotId: "snap-1" } }],
    },
    {
      id: "claim-2",
      statement: "Gains hold at every batch size.",
      verificationStatus: "needs_qualification",
      evidenceRelations: [{ relation: "qualifies", evidence: { id: "ev-1", statement: "MoE", status: "active", sourceSnapshotId: "snap-1" } }],
    },
    {
      id: "claim-3",
      statement: "Latency always improves.",
      verificationStatus: "conflicted",
      evidenceRelations: [{ relation: "contradicts", evidence: { id: "ev-1", statement: "MoE", status: "active", sourceSnapshotId: "snap-1" } }],
    },
    {
      id: "claim-4",
      statement: "Cost is negligible.",
      verificationStatus: "unsupported",
      evidenceRelations: [{ relation: "context", evidence: { id: "ev-1", statement: "MoE", status: "active", sourceSnapshotId: "snap-1" } }],
    },
  ];
  const citationMap = {
    "claim-1": [{
      evidenceId: "ev-1",
      sourceSnapshotId: "snap-1",
      relation: "supports",
      locator: { kind: "sciverse", docId: "d".repeat(64), offset: 120 },
      source: { id: "src-1", kind: "academic_paper", title: "Sparse routing at scale", canonicalUrl: "https://doi.org/10.1/x", doi: "10.1/x", provider: "sciverse", authors: ["Jane Doe"], year: 2024 },
    }],
  };

  it("renders all four verification statuses distinctly", () => {
    render(
      <ResearchReportEvidencePanel
        claims={claims}
        evidence={[evidence()]}
        citationMap={citationMap}
        evidenceRefs={["ev-1"]}
        selectedEvidenceId={null}
        onSelectEvidence={() => undefined}
      />,
    );
    expect(screen.getByText(/已核验/)).toBeInTheDocument();
    expect(screen.getByText(/需限定/)).toBeInTheDocument();
    expect(screen.getByText(/存在争议/)).toBeInTheDocument();
    expect(screen.getByText(/证据不足/)).toBeInTheDocument();
  });

  it("opens a detail card that reuses citationMap (authors, year, DOI, locator, relation)", () => {
    render(
      <ResearchReportEvidencePanel
        claims={claims}
        evidence={[evidence()]}
        citationMap={citationMap}
        evidenceRefs={["ev-1"]}
        selectedEvidenceId="ev-1"
        onSelectEvidence={() => undefined}
      />,
    );
    expect(screen.getByText("Sparse routing at scale")).toBeInTheDocument();
    expect(screen.getByText("Jane Doe · 2024")).toBeInTheDocument();
    expect(screen.getByText("DOI：10.1/x")).toBeInTheDocument();
    expect(screen.getByText(/定位：kind：sciverse/)).toBeInTheDocument();
    expect(screen.getAllByText("支持").length).toBeGreaterThan(0);
  });

  it("lets keyboard users select an evidence entry", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <ResearchReportEvidencePanel
        claims={claims}
        evidence={[evidence()]}
        citationMap={citationMap}
        evidenceRefs={["ev-1"]}
        selectedEvidenceId={null}
        onSelectEvidence={onSelect}
      />,
    );
    await user.tab();
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalled();
  });

  it("does not fabricate a source when the evidence is missing from citationMap", () => {
    render(
      <ResearchReportEvidencePanel
        claims={claims}
        evidence={[evidence()]}
        citationMap={{}}
        evidenceRefs={["ev-1"]}
        selectedEvidenceId="ev-1"
        onSelectEvidence={() => undefined}
      />,
    );
    expect(screen.getByText(/没有进入 citationMap/)).toBeInTheDocument();
    expect(screen.queryByText("Jane Doe · 2024")).not.toBeInTheDocument();
  });

  it("marks the selected evidence with aria-pressed", () => {
    render(
      <ResearchReportEvidencePanel
        claims={claims}
        evidence={[evidence()]}
        citationMap={citationMap}
        evidenceRefs={["ev-1"]}
        selectedEvidenceId="ev-1"
        onSelectEvidence={() => undefined}
      />,
    );
    const pressed = screen.getAllByRole("button").filter((button) => button.getAttribute("aria-pressed") === "true");
    expect(pressed.length).toBeGreaterThan(0);
  });
});
