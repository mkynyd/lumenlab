import { describe, it, expect, vi, beforeEach } from "vitest";
import { createDocumentChunks } from "../vector-store";
import { prisma } from "@/lib/db";
import crypto from "crypto";
import type { DocumentBlock } from "@/lib/document-pipeline/types";

vi.mock("@/lib/db", () => ({
  prisma: {
    documentChunk: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/cache/rag-search-cache", () => ({
  invalidateSearchCache: vi.fn(),
}));

describe("createDocumentChunks", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(prisma.documentChunk.deleteMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(prisma.documentChunk.createMany).mockResolvedValue({ count: 1 } as never);
  });

  it("creates text chunks for legacy content", async () => {
    const textContent = "Hello world. This is a test.";
    const count = await createDocumentChunks({
      fileAssetId: "f1",
      projectId: "p1",
      userId: "u1",
      textContent,
      title: "doc",
    });
    expect(count).toBeGreaterThan(0);
    expect(vi.mocked(prisma.documentChunk.deleteMany).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(prisma.documentChunk.createMany).mock.invocationCallOrder[0]
    );
    expect(prisma.documentChunk.createMany).toHaveBeenCalled();

    const call = vi.mocked(prisma.documentChunk.createMany).mock.calls[0][0] as unknown as {
      data: { contentHash: string; metadata?: unknown }[];
    };
    const expectedHash = crypto.createHash("sha256").update(textContent).digest("hex").slice(0, 32);
    expect(call.data[0].contentHash).toBe(expectedHash);
    expect(call.data[0].metadata).toBeUndefined();
  });

  it("creates image chunks from blocks", async () => {
    const blocks: DocumentBlock[] = [
      {
        type: "image",
        id: "i1",
        assetId: "a1",
        relativePath: "pics/chart.png",
        visionSummary: "A bar chart.",
        analysisStatus: "parsed",
      },
    ];
    const map = new Map([["pics/chart.png", "https://example.com/res/a1"]]);
    await createDocumentChunks({
      fileAssetId: "f1",
      projectId: "p1",
      userId: "u1",
      textContent: "A bar chart.",
      title: "doc",
      blocks,
      assetResourceUrlMap: map,
    });
    expect(vi.mocked(prisma.documentChunk.deleteMany).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(prisma.documentChunk.createMany).mock.invocationCallOrder[0]
    );
    const call = vi.mocked(prisma.documentChunk.createMany).mock.calls[0][0] as unknown as {
      data: { mediaUrls: string[]; metadata?: { sourceType: string } }[];
    };
    const imageChunk = call.data.find((d) => d.metadata?.sourceType?.startsWith("image"));
    expect(imageChunk).toBeDefined();
    expect(imageChunk!.mediaUrls).toContain("https://example.com/res/a1");
  });

  it("creates mixed text and image chunks with media urls", async () => {
    const blocks: DocumentBlock[] = [
      {
        type: "text",
        id: "t1",
        content: "First paragraph of text content.",
      },
      {
        type: "image",
        id: "i1",
        assetId: "a1",
        relativePath: "pics/chart.png",
        visionSummary: "A bar chart.",
        analysisStatus: "parsed",
      },
    ];
    const map = new Map([["pics/chart.png", "https://example.com/res/a1"]]);
    const count = await createDocumentChunks({
      fileAssetId: "f1",
      projectId: "p1",
      userId: "u1",
      textContent: "First paragraph of text content. A bar chart.",
      title: "doc",
      blocks,
      assetResourceUrlMap: map,
    });
    const call = vi.mocked(prisma.documentChunk.createMany).mock.calls[0][0] as unknown as {
      data: { content: string; mediaUrls: string[]; metadata?: { sourceType: string } }[];
    };
    expect(count).toBe(call.data.length);
    expect(call.data.length).toBeGreaterThanOrEqual(2);
    const imageChunk = call.data.find((d) => d.metadata?.sourceType?.startsWith("image"));
    expect(imageChunk).toBeDefined();
    expect(imageChunk!.mediaUrls).toContain("https://example.com/res/a1");
    const textChunk = call.data.find((d) => d.metadata?.sourceType === "text");
    expect(textChunk).toBeDefined();
  });

  it("creates image fallback chunks when no vision summary or text exists", async () => {
    const blocks: DocumentBlock[] = [
      {
        type: "image",
        id: "i1",
        assetId: "a1",
        relativePath: "pics/chart.png",
        altText: "A chart.",
        analysisStatus: "parsed",
      },
    ];
    const map = new Map([["pics/chart.png", "https://example.com/res/a1"]]);
    await createDocumentChunks({
      fileAssetId: "f1",
      projectId: "p1",
      userId: "u1",
      textContent: "A chart.",
      title: "doc",
      blocks,
      assetResourceUrlMap: map,
    });
    const call = vi.mocked(prisma.documentChunk.createMany).mock.calls[0][0] as unknown as {
      data: { mediaUrls: string[]; metadata?: { sourceType: string } }[];
    };
    expect(call.data.length).toBe(1);
    expect(call.data[0].metadata?.sourceType).toBe("image_fallback");
    expect(call.data[0].mediaUrls).toContain("https://example.com/res/a1");
  });

  it("returns 0 for empty content", async () => {
    const count = await createDocumentChunks({
      fileAssetId: "f1",
      projectId: null,
      userId: "u1",
      textContent: "",
    });
    expect(count).toBe(0);
    expect(prisma.documentChunk.createMany).not.toHaveBeenCalled();
  });
});
