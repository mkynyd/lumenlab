import { describe, expect, it } from "vitest";
import { buildChunksFromBlocks } from "../chunk-builder";
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
});
