import { describe, it, expect } from "vitest";
import { buildParseQualityReport } from "../quality-checker";
import type { DocumentBlock, ParsingMetadata } from "../types";

describe("buildParseQualityReport", () => {
  it("counts blocks and images", () => {
    const blocks: DocumentBlock[] = [
      { type: "heading", id: "h1", level: 1, content: "Title" },
      { type: "image", id: "i1", assetId: "a1", relativePath: "pics/c.png", analysisStatus: "parsed", visionSummary: "chart", confidence: 0.9 },
      { type: "image", id: "i2", assetId: "a2", relativePath: "pics/d.png", analysisStatus: "failed" },
    ];
    const meta: ParsingMetadata = {
      parser: "mineru-office",
      pipelineVersion: "0.2.0",
      sourceKind: "office",
      requiresVisionModel: true,
      assetCount: 2,
      parseStartedAt: "",
      parseCompletedAt: "",
      parseWarnings: [],
    };
    const report = buildParseQualityReport({ blocks, assets: [], content: "Title chart", metadata: meta });
    expect(report.imageAnalyzedCount).toBe(1);
    expect(report.failedImageCount).toBe(1);
    expect(report.checks.length).toBeGreaterThan(0);
  });
});
