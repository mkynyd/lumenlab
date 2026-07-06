// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ImageParser } from "../parsers/image-parser";
import * as minimaxAnalyzer from "../vision/minimax-analyzer";
import type { ParseInput } from "../types";

vi.mock("../vision/minimax-analyzer");

function makeInput(filename: string, mimeType: string, data: Buffer, apiKeys: ParseInput["apiKeys"] = {}): ParseInput {
  return {
    userId: "u1",
    fileAssetId: "f1",
    filename,
    mimeType,
    data,
    apiKeys,
  };
}

describe("ImageParser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["photo.png", "image/png"],
    ["photo.jpg", "image/jpeg"],
    ["photo.jpeg", "image/jpeg"],
    ["photo.webp", "image/webp"],
  ])("can parse %s (%s)", (filename, mimeType) => {
    const parser = new ImageParser();
    expect(parser.canParse(makeInput(filename, mimeType, Buffer.alloc(10)))).toBe(true);
  });

  it("can parse by extension when mime type is generic", () => {
    const parser = new ImageParser();
    expect(parser.canParse(makeInput("scan.png", "application/octet-stream", Buffer.alloc(10)))).toBe(true);
    expect(parser.canParse(makeInput("scan.jpg", "application/octet-stream", Buffer.alloc(10)))).toBe(true);
  });

  it("does not parse non-image files", () => {
    const parser = new ImageParser();
    expect(parser.canParse(makeInput("notes.md", "text/markdown", Buffer.from("# Hello")))).toBe(false);
    expect(parser.canParse(makeInput("doc.pdf", "application/pdf", Buffer.alloc(10)))).toBe(false);
    expect(parser.canParse(makeInput("archive.zip", "application/zip", Buffer.alloc(10)))).toBe(false);
  });

  it("parses a standalone image into a single text block", async () => {
    vi.mocked(minimaxAnalyzer.analyzeImageWithMiniMax).mockResolvedValue({
      summary: "A bar chart showing sales over time.",
      ocrText: "Q1: 100\nQ2: 200",
      confidence: 0.9,
      warnings: [],
    });

    const parser = new ImageParser();
    const result = await parser.parse(
      makeInput("chart.png", "image/png", Buffer.alloc(1_000), { minimax: "sk-minimax" })
    );

    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].type).toBe("text");
    const textBlock = result.blocks[0] as Extract<typeof result.blocks[number], { type: "text" }>;
    expect(textBlock.content).toContain("A bar chart showing sales over time.");
    expect(textBlock.content).toContain("Q1: 100");

    expect(result.assets).toHaveLength(0);
    expect(result.metadata.parser).toBe("minimax-m3-image");
    expect(result.metadata.sourceKind).toBe("image");
    expect(result.metadata.requiresVisionModel).toBe(true);
    expect(result.metadata.assetCount).toBe(0);
  });

  it("calls MiniMax with base64 image data", async () => {
    vi.mocked(minimaxAnalyzer.analyzeImageWithMiniMax).mockResolvedValue({
      summary: "A diagram",
      ocrText: "node a -> node b",
      confidence: 0.8,
      warnings: [],
    });

    const parser = new ImageParser();
    const data = Buffer.from("fake-image-bytes");
    await parser.parse(makeInput("diagram.png", "image/png", data, { minimax: "sk-minimax" }));

    expect(minimaxAnalyzer.analyzeImageWithMiniMax).toHaveBeenCalledTimes(1);
    const call = vi.mocked(minimaxAnalyzer.analyzeImageWithMiniMax).mock.calls[0][0];
    expect(call.apiKey).toBe("sk-minimax");
    expect(call.image).toEqual({
      type: "base64",
      mediaType: "image/png",
      data,
    });
  });

  it("infers jpeg media type from .jpg extension", async () => {
    vi.mocked(minimaxAnalyzer.analyzeImageWithMiniMax).mockResolvedValue({
      summary: "A photo",
      ocrText: "",
      confidence: 0.7,
      warnings: [],
    });

    const parser = new ImageParser();
    await parser.parse(makeInput("photo.jpg", "application/octet-stream", Buffer.alloc(100), { minimax: "sk-minimax" }));

    const call = vi.mocked(minimaxAnalyzer.analyzeImageWithMiniMax).mock.calls[0][0];
    const image = call.image as Extract<typeof call.image, { type: "base64" }>;
    expect(image.mediaType).toBe("image/jpeg");
  });

  it("throws when MiniMax API key is missing", async () => {
    const parser = new ImageParser();
    await expect(
      parser.parse(makeInput("photo.png", "image/png", Buffer.alloc(10), {}))
    ).rejects.toThrow("尚未配置 MiniMax API Key");
  });

  it("passes through analyzer warnings", async () => {
    vi.mocked(minimaxAnalyzer.analyzeImageWithMiniMax).mockResolvedValue({
      summary: "Low quality image",
      ocrText: "",
      confidence: 0.3,
      warnings: ["低置信度"],
    });

    const parser = new ImageParser();
    const result = await parser.parse(
      makeInput("blurry.png", "image/png", Buffer.alloc(10), { minimax: "sk-minimax" })
    );

    expect(result.metadata.parseWarnings).toEqual(["低置信度"]);
  });
});
