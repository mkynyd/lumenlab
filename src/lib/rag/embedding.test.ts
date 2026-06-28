import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  embedQuery,
  embedTexts,
  embedChunksForFile,
  EMBEDDING_DIM,
  EMBEDDING_MODEL,
} from "./embedding";

const mockCreateMultiModalEmbedding = vi.hoisted(() => vi.fn());
const mockPrismaDocumentChunkFindMany = vi.hoisted(() => vi.fn());
const mockPrismaExecuteRawUnsafe = vi.hoisted(() => vi.fn());

vi.mock("dashscope-sdk-official", () => ({
  Configuration: class {},
  DashscopeApi: class {
    createMultiModalEmbedding = mockCreateMultiModalEmbedding;
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    documentChunk: { findMany: mockPrismaDocumentChunkFindMany },
    $executeRawUnsafe: mockPrismaExecuteRawUnsafe,
  },
}));

describe("embedding", () => {
  beforeEach(() => {
    mockCreateMultiModalEmbedding.mockReset();
    mockPrismaDocumentChunkFindMany.mockReset();
    mockPrismaExecuteRawUnsafe.mockReset();
  });

  it("embedQuery returns a 1024-dim vector", async () => {
    mockCreateMultiModalEmbedding.mockResolvedValue({
      status_code: 200,
      output: {
        embeddings: [{ text_index: 0, embedding: Array(EMBEDDING_DIM).fill(0.1) }],
      },
    });

    const vector = await embedQuery("hello", "sk-test");

    expect(vector).toHaveLength(EMBEDDING_DIM);
    expect(mockCreateMultiModalEmbedding).toHaveBeenCalledWith({
      model: EMBEDDING_MODEL,
      input: [{ text: "hello" }],
      enable_fusion: false,
      dimension: EMBEDDING_DIM,
    });
  });

  it("embedTexts batches correctly", async () => {
    mockCreateMultiModalEmbedding.mockResolvedValue({
      status_code: 200,
      output: {
        embeddings: [
          { text_index: 0, embedding: Array(EMBEDDING_DIM).fill(0.1) },
          { text_index: 1, embedding: Array(EMBEDDING_DIM).fill(0.2) },
        ],
      },
    });

    const vectors = await embedTexts(["a", "b"], "sk-test");

    expect(vectors).toHaveLength(2);
    expect(vectors[0]).toHaveLength(EMBEDDING_DIM);
    expect(vectors[1]).toHaveLength(EMBEDDING_DIM);
  });

  it("throws on SDK error", async () => {
    mockCreateMultiModalEmbedding.mockResolvedValue({
      status_code: 400,
      code: "InvalidParameter",
      message: "bad request",
    });

    await expect(embedQuery("hello", "sk-test")).rejects.toThrow("Embedding failed");
  });

  it("throws on dimension mismatch", async () => {
    mockCreateMultiModalEmbedding.mockResolvedValue({
      status_code: 200,
      output: {
        embeddings: [{ text_index: 0, embedding: Array(EMBEDDING_DIM - 1).fill(0.1) }],
      },
    });

    await expect(embedQuery("hello", "sk-test")).rejects.toThrow("dimension mismatch");
  });

  it("embedChunksForFile fuses text with image and video URLs", async () => {
    const chunks = [
      {
        id: "chunk-1",
        content: "text content",
        mediaUrls: ["https://example.com/image.png", "https://example.com/video.mp4"],
      },
    ];
    mockPrismaDocumentChunkFindMany.mockResolvedValue(chunks);
    mockCreateMultiModalEmbedding.mockResolvedValue({
      status_code: 200,
      output: {
        embeddings: [{ embedding: Array(EMBEDDING_DIM).fill(0.3) }],
      },
    });

    await embedChunksForFile({ fileAssetId: "file-1", apiKey: "sk-test" });

    expect(mockPrismaDocumentChunkFindMany).toHaveBeenCalledWith({
      where: { fileAssetId: "file-1" },
      select: { id: true, content: true, mediaUrls: true },
      orderBy: { chunkIndex: "asc" },
    });
    expect(mockCreateMultiModalEmbedding).toHaveBeenCalledWith({
      model: EMBEDDING_MODEL,
      input: [
        { text: "text content" },
        { image: "https://example.com/image.png" },
        { video: "https://example.com/video.mp4" },
      ],
      enable_fusion: true,
      dimension: EMBEDDING_DIM,
    });
    expect(mockPrismaExecuteRawUnsafe).toHaveBeenCalledWith(
      `UPDATE "DocumentChunk" SET embedding = $1::vector WHERE id = $2`,
      expect.any(String),
      "chunk-1"
    );
  });

  it("embedChunksForFile caps media URLs at 5 per fusion request", async () => {
    const mediaUrls = Array.from({ length: 7 }, (_, i) => `https://example.com/img${i}.png`);
    const chunks = [
      {
        id: "chunk-2",
        content: "text content",
        mediaUrls,
      },
    ];
    mockPrismaDocumentChunkFindMany.mockResolvedValue(chunks);
    mockCreateMultiModalEmbedding.mockResolvedValue({
      status_code: 200,
      output: {
        embeddings: [{ embedding: Array(EMBEDDING_DIM).fill(0.3) }],
      },
    });

    await embedChunksForFile({ fileAssetId: "file-1", apiKey: "sk-test" });

    const call = mockCreateMultiModalEmbedding.mock.calls[0][0];
    expect(call.input).toHaveLength(6); // 1 text + 5 images
    expect(call.input.slice(1)).toEqual(
      mediaUrls.slice(0, 5).map((url) => ({ image: url }))
    );
  });
});
