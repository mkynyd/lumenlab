// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  filterImagesForAnalysis,
  inferImageMode,
} from "@/lib/document-pipeline/image-filter";
import type { ImageBlock, ParsedAsset } from "@/lib/document-pipeline/types";

function makePngBuffer(width: number, height: number, extraBytes = 0): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrLength = Buffer.alloc(4);
  ihdrLength.writeUInt32BE(13, 0);
  const ihdrType = Buffer.from("IHDR", "ascii");
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 2;
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(0, 0);
  const padding = Buffer.alloc(extraBytes);
  return Buffer.concat([signature, ihdrLength, ihdrType, ihdrData, crc, padding]);
}

function makeAsset(
  id: string,
  mimeType: string,
  buffer: Buffer,
  overrides: Partial<ParsedAsset> = {}
): ParsedAsset {
  return {
    id,
    relativePath: `${id}.bin`,
    mimeType,
    buffer,
    sha256: `${id}-hash`,
    ...overrides,
  };
}

function makeBlock(id: string, assetId: string, overrides: Partial<ImageBlock> = {}): ImageBlock {
  return {
    type: "image",
    id,
    assetId,
    relativePath: `${assetId}.png`,
    analysisStatus: "pending",
    ...overrides,
  };
}

describe("inferImageMode", () => {
  it("infers chart mode from filename/alt/surrounding text", () => {
    expect(
      inferImageMode(makeBlock("b1", "a1", { relativePath: "sales-chart.png" }))
    ).toBe("chart");
    expect(
      inferImageMode(makeBlock("b1", "a1", { altText: "年度趋势图" }))
    ).toBe("chart");
    expect(
      inferImageMode(makeBlock("b1", "a1", { surroundingText: "见下图饼图" }))
    ).toBe("chart");
  });

  it("infers diagram mode", () => {
    expect(
      inferImageMode(makeBlock("b1", "a1", { relativePath: "system-diagram.png" }))
    ).toBe("diagram");
    expect(
      inferImageMode(makeBlock("b1", "a1", { relativePath: "data-flow.png" }))
    ).toBe("diagram");
    expect(
      inferImageMode(makeBlock("b1", "a1", { altText: "系统架构图" }))
    ).toBe("diagram");
    expect(
      inferImageMode(makeBlock("b1", "a1", { altText: "流程图" }))
    ).toBe("diagram");
  });

  it("infers code mode", () => {
    expect(
      inferImageMode(makeBlock("b1", "a1", { relativePath: "code-snippet.png" }))
    ).toBe("code");
    expect(
      inferImageMode(makeBlock("b1", "a1", { altText: "代码截图" }))
    ).toBe("code");
  });

  it("infers ocr mode for formulas and questions", () => {
    expect(
      inferImageMode(makeBlock("b1", "a1", { relativePath: "math-formula.png" }))
    ).toBe("ocr");
    expect(
      inferImageMode(makeBlock("b1", "a1", { altText: "手写答案" }))
    ).toBe("ocr");
    expect(
      inferImageMode(makeBlock("b1", "a1", { surroundingText: "quiz question" }))
    ).toBe("ocr");
  });

  it("infers general mode for experiments", () => {
    expect(
      inferImageMode(makeBlock("b1", "a1", { relativePath: "lab-experiment.png" }))
    ).toBe("general");
    expect(
      inferImageMode(makeBlock("b1", "a1", { altText: "实验结果" }))
    ).toBe("general");
  });

  it("falls back to general", () => {
    expect(inferImageMode(makeBlock("b1", "a1", {}))).toBe("general");
  });
});

describe("filterImagesForAnalysis", () => {
  it("retains large meaningful images and skips small ones", () => {
    const large = makePngBuffer(200, 200, 60_000);
    const small = makePngBuffer(200, 200, 100);

    const assets: ParsedAsset[] = [
      makeAsset("a-large", "image/png", large, { sha256: "large-hash" }),
      makeAsset("a-small", "image/png", small, { sha256: "small-hash" }),
    ];

    const blocks: ImageBlock[] = [
      makeBlock("b1", "a-large", { relativePath: "diagram.png", altText: "architecture" }),
      makeBlock("b2", "a-small", { relativePath: "tiny.png" }),
    ];

    const result = filterImagesForAnalysis(blocks, assets);
    expect(result.retained).toHaveLength(1);
    expect(result.retained[0].id).toBe("b1");
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].block.id).toBe("b2");
  });

  it("deduplicates by sha256", () => {
    const image = makePngBuffer(200, 200, 60_000);

    const assets: ParsedAsset[] = [
      makeAsset("a1", "image/png", image, { sha256: "dup-hash" }),
      makeAsset("a2", "image/png", image, { sha256: "dup-hash" }),
    ];

    const blocks: ImageBlock[] = [
      makeBlock("b1", "a1", { relativePath: "fig1.png" }),
      makeBlock("b2", "a2", { relativePath: "fig2.png" }),
    ];

    const result = filterImagesForAnalysis(blocks, assets);
    expect(result.retained).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toContain("duplicate");
  });

  it("skips decorative filenames", () => {
    const image = makePngBuffer(200, 200, 60_000);

    const assets: ParsedAsset[] = [
      makeAsset("a1", "image/png", image, { sha256: "h1" }),
      makeAsset("a2", "image/png", image, { sha256: "h2" }),
      makeAsset("a3", "image/png", image, { sha256: "h3" }),
      makeAsset("a4", "image/png", image, { sha256: "h4" }),
    ];

    const blocks: ImageBlock[] = [
      makeBlock("b1", "a1", { relativePath: "company-logo.png" }),
      makeBlock("b2", "a2", { relativePath: "page-watermark.png" }),
      makeBlock("b3", "a3", { relativePath: "页眉装饰.png" }),
      makeBlock("b4", "a4", { relativePath: "页脚-line.png" }),
    ];

    const result = filterImagesForAnalysis(blocks, assets);
    expect(result.retained).toHaveLength(0);
    expect(result.skipped).toHaveLength(4);
    expect(result.skipped.every((s) => s.reason.includes("decorative"))).toBe(true);
  });

  it("skips unsupported mime types", () => {
    const assets: ParsedAsset[] = [
      makeAsset("a1", "image/gif", makePngBuffer(200, 200, 60_000), { sha256: "h1" }),
      makeAsset("a2", "image/svg+xml", makePngBuffer(200, 200, 60_000), { sha256: "h2" }),
    ];

    const blocks: ImageBlock[] = [
      makeBlock("b1", "a1", { relativePath: "anim.gif" }),
      makeBlock("b2", "a2", { relativePath: "icon.svg" }),
    ];

    const result = filterImagesForAnalysis(blocks, assets);
    expect(result.retained).toHaveLength(0);
    expect(result.skipped).toHaveLength(2);
    expect(result.skipped.every((s) => s.reason.includes("mime"))).toBe(true);
  });

  it("skips images below minimum byte size", () => {
    const image = makePngBuffer(200, 200, 1_500);

    const assets: ParsedAsset[] = [
      makeAsset("a1", "image/png", image, { sha256: "h1" }),
    ];

    const blocks: ImageBlock[] = [
      makeBlock("b1", "a1", { relativePath: "small.png" }),
    ];

    const result = filterImagesForAnalysis(blocks, assets);
    expect(result.skipped[0].reason).toContain("byte");
  });

  it("parses PNG dimensions and skips too-small PNGs", () => {
    const smallPng = makePngBuffer(50, 50, 60_000);
    const largePng = makePngBuffer(200, 200, 60_000);

    const assets: ParsedAsset[] = [
      makeAsset("a1", "image/png", smallPng, { sha256: "h1" }),
      makeAsset("a2", "image/png", largePng, { sha256: "h2" }),
    ];

    const blocks: ImageBlock[] = [
      makeBlock("b1", "a1", { relativePath: "small.png" }),
      makeBlock("b2", "a2", { relativePath: "large.png" }),
    ];

    const result = filterImagesForAnalysis(blocks, assets);
    expect(result.retained).toHaveLength(1);
    expect(result.retained[0].id).toBe("b2");
    expect(result.skipped[0].reason).toContain("dimension");
  });

  it("retains JPEG/WebP when dimensions cannot be parsed if bytes exceed retainMinBytes", () => {
    const large = Buffer.alloc(60_000, 0xff);
    const assets: ParsedAsset[] = [
      makeAsset("a1", "image/jpeg", large, { sha256: "h1" }),
    ];

    const blocks: ImageBlock[] = [
      makeBlock("b1", "a1", { relativePath: "photo.jpg", altText: "experiment setup" }),
    ];

    const result = filterImagesForAnalysis(blocks, assets);
    expect(result.retained).toHaveLength(1);
  });

  it("skips JPEG/WebP without dimensions or content hint when below retainMinBytes", () => {
    const small = Buffer.alloc(10_000, 0xff);
    const assets: ParsedAsset[] = [
      makeAsset("a1", "image/jpeg", small, { sha256: "h1" }),
    ];

    const blocks: ImageBlock[] = [
      makeBlock("b1", "a1", { relativePath: "photo.jpg" }),
    ];

    const result = filterImagesForAnalysis(blocks, assets);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toContain("content hint");
  });

  it("applies skip rules in order: mime before byte size", () => {
    const tinyGif = Buffer.alloc(100, 0);
    const assets: ParsedAsset[] = [
      makeAsset("a1", "image/gif", tinyGif, { sha256: "h1" }),
    ];

    const blocks: ImageBlock[] = [
      makeBlock("b1", "a1", { relativePath: "tiny.gif" }),
    ];

    const result = filterImagesForAnalysis(blocks, assets);
    expect(result.skipped[0].reason).toContain("mime");
  });

  it("ignores blocks missing a matching asset", () => {
    const image = makePngBuffer(200, 200, 60_000);
    const assets: ParsedAsset[] = [
      makeAsset("a1", "image/png", image, { sha256: "h1" }),
    ];

    const blocks: ImageBlock[] = [
      makeBlock("b1", "a-missing", { relativePath: "missing.png" }),
    ];

    const result = filterImagesForAnalysis(blocks, assets);
    expect(result.retained).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toContain("asset");
  });

  it("respects custom options", () => {
    const image = makePngBuffer(80, 80, 60_000);
    const assets: ParsedAsset[] = [
      makeAsset("a1", "image/png", image, { sha256: "h1" }),
    ];

    const blocks: ImageBlock[] = [
      makeBlock("b1", "a1", { relativePath: "icon-large.png" }),
    ];

    const result = filterImagesForAnalysis(blocks, assets, {
      minWidth: 100,
      minHeight: 100,
      minBytes: 1_000,
      retainMinBytes: 100_000,
    });
    expect(result.skipped[0].reason).toContain("dimension");
  });
});
