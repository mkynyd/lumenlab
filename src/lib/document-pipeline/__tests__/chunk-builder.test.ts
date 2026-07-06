import { describe, expect, it } from "vitest";
import { buildChunksFromBlocks, splitText } from "../chunk-builder";
import type { DocumentBlock } from "../types";

describe("buildChunksFromBlocks", () => {
  it("creates text chunks for paragraphs", () => {
    const blocks: DocumentBlock[] = [
      { type: "text", id: "t1", content: "Hello world. This is a test." },
    ];
    const chunks = buildChunksFromBlocks(blocks, new Map());
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].content).toContain("Hello world");
    expect(chunks[0].metadata?.sourceType).toBe("text");
  });

  it("creates image chunks with mediaUrls", () => {
    const blocks: DocumentBlock[] = [
      {
        type: "image",
        id: "i1",
        assetId: "a1",
        relativePath: "pics/chart.png",
        altText: "chart",
        visionSummary: "A bar chart.",
        visionText: "10, 20",
        analysisStatus: "parsed",
      },
    ];
    const map = new Map([["pics/chart.png", "https://example.com/res/a1"]]);
    const chunks = buildChunksFromBlocks(blocks, map);
    const imageChunks = chunks.filter((c) =>
      c.metadata?.sourceType?.startsWith("image")
    );
    expect(imageChunks.length).toBeGreaterThan(0);
    expect(imageChunks[0].mediaUrls).toContain("https://example.com/res/a1");
  });

  it("sets sourceType to block type for heading and code blocks", () => {
    const blocks: DocumentBlock[] = [
      { type: "heading", id: "h1", level: 2, content: "Section A" },
      { type: "code", id: "c1", language: "ts", content: "const x = 1;" },
    ];
    const chunks = buildChunksFromBlocks(blocks, new Map());
    const headingChunk = chunks.find((c) => c.metadata?.blockId === "h1");
    const codeChunk = chunks.find((c) => c.metadata?.blockId === "c1");
    expect(headingChunk?.metadata?.sourceType).toBe("heading");
    expect(headingChunk?.content).toContain("Section A");
    expect(codeChunk?.metadata?.sourceType).toBe("code");
    expect(codeChunk?.content).toContain("```ts");
  });

  it("produces a single chunk for table and formula blocks", () => {
    const blocks: DocumentBlock[] = [
      {
        type: "table",
        id: "tbl1",
        markdown: "| a | b |\n|---|---|\n| 1 | 2 |",
      },
      { type: "formula", id: "f1", content: "E = mc^2" },
    ];
    const chunks = buildChunksFromBlocks(blocks, new Map());
    expect(chunks.length).toBe(2);
    expect(chunks[0].metadata?.sourceType).toBe("table");
    expect(chunks[0].content).toContain("| a | b |");
    expect(chunks[1].metadata?.sourceType).toBe("formula");
    expect(chunks[1].content).toBe("$$E = mc^2$$");
  });

  it("creates an image_fallback chunk when no vision summary or text exists", () => {
    const blocks: DocumentBlock[] = [
      {
        type: "image",
        id: "i2",
        assetId: "a2",
        relativePath: "pics/diagram.png",
        altText: "diagram",
        analysisStatus: "skipped",
        skipReason: "vision model not configured",
      },
    ];
    const map = new Map([["pics/diagram.png", "https://example.com/res/a2"]]);
    const chunks = buildChunksFromBlocks(blocks, map);
    expect(chunks.length).toBe(1);
    expect(chunks[0].metadata?.sourceType).toBe("image_fallback");
    expect(chunks[0].mediaUrls).toContain("https://example.com/res/a2");
    expect(chunks[0].content).toContain("diagram");
  });

  it("includes warnings for failed image analysis", () => {
    const blocks: DocumentBlock[] = [
      {
        type: "image",
        id: "i3",
        assetId: "a3",
        relativePath: "pics/scan.png",
        altText: "scan",
        analysisStatus: "failed",
        skipReason: "vision request timed out",
        confidence: 0.2,
      },
    ];
    const map = new Map([["pics/scan.png", "https://example.com/res/a3"]]);
    const chunks = buildChunksFromBlocks(blocks, map);
    expect(chunks.length).toBe(1);
    expect(chunks[0].metadata?.sourceType).toBe("image_fallback");
    expect(chunks[0].metadata?.warnings).toContain("vision request timed out");
    expect(chunks[0].metadata?.confidence).toBe(0.2);
  });
});

describe("splitText", () => {
  it("returns an empty array for an empty string", () => {
    expect(splitText("", 100, 10)).toEqual([]);
  });

  it("returns a single trimmed chunk for a short string", () => {
    expect(splitText("Hello world.", 100, 10)).toEqual(["Hello world."]);
  });

  it("splits a long string with overlap and respects natural boundaries", () => {
    const text =
      "First sentence. Second sentence. Third sentence. Fourth sentence. Fifth sentence.";
    const chunks = splitText(text, 40, 10);
    expect(chunks.length).toBeGreaterThan(1);
    // Each chunk after the first should overlap with the previous content.
    for (let i = 1; i < chunks.length; i++) {
      const previous = chunks[i - 1];
      const current = chunks[i];
      expect(current.length).toBeGreaterThan(0);
      // Overlap: at least part of the previous chunk text appears in the current chunk.
      expect(previous.slice(-10)).toContain(current.slice(0, 5));
    }
  });

  it("throws for invalid size or overlap", () => {
    expect(() => splitText("text", 0, 0)).toThrow("size");
    expect(() => splitText("text", 10, -1)).toThrow("overlap");
    expect(() => splitText("text", 10, 10)).toThrow("overlap");
  });
});
