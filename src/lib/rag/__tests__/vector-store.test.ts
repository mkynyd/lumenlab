import { describe, it, expect, vi, beforeEach } from "vitest";
import { createDocumentChunks } from "../vector-store";
import { prisma } from "@/lib/db";
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
    const count = await createDocumentChunks({
      fileAssetId: "f1",
      projectId: "p1",
      userId: "u1",
      textContent: "Hello world. This is a test.",
      title: "doc",
    });
    expect(count).toBeGreaterThan(0);
    expect(prisma.documentChunk.createMany).toHaveBeenCalled();
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
    const call = vi.mocked(prisma.documentChunk.createMany).mock.calls[0][0] as unknown as { data: { mediaUrls: string[]; metadata: { sourceType: string } }[] };
    const imageChunk = call.data.find((d) => d.metadata?.sourceType?.startsWith("image"));
    expect(imageChunk).toBeDefined();
    expect(imageChunk!.mediaUrls).toContain("https://example.com/res/a1");
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
