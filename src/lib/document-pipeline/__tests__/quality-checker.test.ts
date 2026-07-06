import { describe, it, expect } from "vitest";
import { buildParseQualityReport } from "../quality-checker";
import type { DocumentBlock, ParsingMetadata } from "../types";

const baseMeta: ParsingMetadata = {
  parser: "mineru-office",
  pipelineVersion: "0.2.0",
  sourceKind: "office",
  requiresVisionModel: true,
  assetCount: 2,
  parseStartedAt: "",
  parseCompletedAt: "",
  parseWarnings: [],
};

describe("buildParseQualityReport", () => {
  it("counts blocks and images", () => {
    const blocks: DocumentBlock[] = [
      { type: "heading", id: "h1", level: 1, content: "Title" },
      { type: "image", id: "i1", assetId: "a1", relativePath: "pics/c.png", analysisStatus: "parsed", visionSummary: "chart", confidence: 0.9 },
      { type: "image", id: "i2", assetId: "a2", relativePath: "pics/d.png", analysisStatus: "failed" },
    ];
    const report = buildParseQualityReport({ blocks, assets: [], content: "Title chart", metadata: baseMeta });
    expect(report.imageAnalyzedCount).toBe(1);
    expect(report.failedImageCount).toBe(1);
    expect(report.checks.length).toBeGreaterThan(0);
  });

  it("flags empty content", () => {
    const blocks: DocumentBlock[] = [{ type: "text", id: "t1", content: "" }];
    const report = buildParseQualityReport({ blocks, assets: [], content: "   ", metadata: baseMeta });
    const check = report.checks.find((c) => c.rule === "non_empty_content");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
    expect(check!.message).toBe("解析结果为空");
  });

  it("flags unresolved image references", () => {
    const blocks: DocumentBlock[] = [];
    const report = buildParseQualityReport({
      blocks,
      assets: [],
      content: "![alt](pics/image.png)",
      metadata: baseMeta,
    });
    const check = report.checks.find((c) => c.rule === "image_references_resolved");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
    expect(check!.message).toBe("Markdown 中仍存在未重写的图片引用");
  });

  it("computes text coverage ratio when originalSize is provided", () => {
    const blocks: DocumentBlock[] = [
      { type: "text", id: "t1", content: "Hello world" },
      { type: "heading", id: "h1", level: 1, content: "Hi" },
    ];
    const report = buildParseQualityReport({
      blocks,
      assets: [],
      content: "Hello world Hi",
      metadata: baseMeta,
      originalSize: 100,
    });
    expect(report.textCoverageRatio).toBe(13 / 100);
  });

  it("warningCount includes metadata parseWarnings and failed checks", () => {
    const blocks: DocumentBlock[] = [];
    const meta: ParsingMetadata = { ...baseMeta, parseWarnings: ["warn-1", "warn-2"] };
    const report = buildParseQualityReport({
      blocks,
      assets: [],
      content: "",
      metadata: meta,
    });
    const failedChecks = report.checks.filter((c) => !c.passed).length;
    expect(failedChecks).toBeGreaterThan(0);
    expect(report.warningCount).toBe(meta.parseWarnings.length + failedChecks);
  });

  it("counts skipped images, tables and formulas", () => {
    const blocks: DocumentBlock[] = [
      { type: "image", id: "i1", assetId: "a1", relativePath: "a.png", analysisStatus: "skipped", skipReason: "unsupported" },
      { type: "image", id: "i2", assetId: "a2", relativePath: "b.png", analysisStatus: "parsed", confidence: 0.9 },
      { type: "table", id: "t1", markdown: "|a|b|\n|---|---|\n|1|2|" },
      { type: "formula", id: "f1", content: "E=mc^2" },
      { type: "formula", id: "f2", content: "a^2+b^2=c^2" },
    ];
    const report = buildParseQualityReport({ blocks, assets: [], content: "content", metadata: baseMeta });
    expect(report.imageSkippedCount).toBe(1);
    expect(report.tableCount).toBe(1);
    expect(report.formulaCount).toBe(2);
  });
});
