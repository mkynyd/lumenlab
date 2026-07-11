import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";
import {
  embedQuery,
  embedTexts,
  embedChunksForFile,
  EMBEDDING_DIM,
  EMBEDDING_MODEL,
} from "./embedding";

const mockCreateMultiModalEmbedding = vi.hoisted(() => vi.fn());
const mockPrismaFileAssetFindUnique = vi.hoisted(() => vi.fn());
const mockPrismaExecuteRawUnsafe = vi.hoisted(() => vi.fn());
const mockRedisGet = vi.hoisted(() => vi.fn());
const mockRedisSetex = vi.hoisted(() => vi.fn());
const mockFetch = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  prisma: {
    fileAsset: { findUnique: mockPrismaFileAssetFindUnique },
    $executeRawUnsafe: mockPrismaExecuteRawUnsafe,
    $queryRawUnsafe: mockPrismaExecuteRawUnsafe,
  },
}));

vi.mock("@/lib/redis", () => ({
  getRedis: () => ({
    get: mockRedisGet,
    setex: mockRedisSetex,
  }),
}));

describe("embedding", () => {
  beforeEach(() => {
    mockCreateMultiModalEmbedding.mockReset();
    mockPrismaFileAssetFindUnique.mockReset();
    mockPrismaExecuteRawUnsafe.mockReset();
    mockRedisGet.mockReset();
    mockRedisSetex.mockReset();
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockImplementation(async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      const result = await mockCreateMultiModalEmbedding({
        model: request.model,
        input: request.input.contents,
        ...request.parameters,
      });
      const { status_code = 200, ...payload } = result ?? {};
      return new Response(JSON.stringify(payload), {
        status: status_code,
        headers: { "Content-Type": "application/json" },
      });
    });
  });

  it("uses the qwen3-vl multimodal-embedding endpoint instead of the legacy one-peace route", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({
        output: {
          embeddings: [{ text_index: 0, embedding: Array(EMBEDDING_DIM).fill(0.1) }],
        },
        request_id: "request-1",
      }), { status: 200, headers: { "Content-Type": "application/json" } })
    );

    await embedTexts(["hello"], "sk-test");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://dashscope.aliyuncs.com/api/v1/services/embeddings/multimodal-embedding/multimodal-embedding",
      expect.objectContaining({ method: "POST" })
    );
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
    mockPrismaFileAssetFindUnique.mockResolvedValue({ textContent: "text content" });
    const chunks = [
      {
        id: "chunk-1",
        content: "text content",
        contentHash: "different-hash",
        mediaUrls: ["https://example.com/image.png", "https://example.com/video.mp4"],
        embedding: null,
      },
    ];
    mockPrismaExecuteRawUnsafe.mockResolvedValueOnce(chunks);
    mockCreateMultiModalEmbedding.mockResolvedValue({
      status_code: 200,
      output: {
        embeddings: [{ embedding: Array(EMBEDDING_DIM).fill(0.3) }],
      },
    });

    await embedChunksForFile({ fileAssetId: "file-1", apiKey: "sk-test" });

    expect(mockPrismaExecuteRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining(`SELECT id, "contentHash", content, "mediaUrls", embedding FROM "DocumentChunk"`),
      "file-1"
    );
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
    mockPrismaFileAssetFindUnique.mockResolvedValue({ textContent: "text content" });
    const mediaUrls = Array.from({ length: 7 }, (_, i) => `https://example.com/img${i}.png`);
    const chunks = [
      {
        id: "chunk-2",
        content: "text content",
        contentHash: "different-hash",
        mediaUrls,
        embedding: null,
      },
    ];
    mockPrismaExecuteRawUnsafe.mockResolvedValueOnce(chunks);
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

  it("skips local media URLs that the cloud embedding service cannot fetch", async () => {
    mockPrismaFileAssetFindUnique.mockResolvedValue({ textContent: "text content" });
    mockPrismaExecuteRawUnsafe.mockResolvedValueOnce([
      {
        id: "chunk-local",
        content: "text content",
        contentHash: "different-hash",
        mediaUrls: ["http://localhost:3000/api/files/image.png", "/api/files/relative.png"],
        embedding: null,
      },
    ]);
    mockCreateMultiModalEmbedding.mockResolvedValue({
      status_code: 200,
      output: {
        embeddings: [{ embedding: Array(EMBEDDING_DIM).fill(0.3) }],
      },
    });

    await embedChunksForFile({ fileAssetId: "file-1", apiKey: "sk-test" });

    expect(mockCreateMultiModalEmbedding).toHaveBeenCalledWith({
      model: EMBEDDING_MODEL,
      input: [{ text: "text content" }],
      enable_fusion: false,
      dimension: EMBEDDING_DIM,
    });
  });

  it("embedChunksForFile short-circuits when contentHash is unchanged and embeddings exist", async () => {
    mockPrismaFileAssetFindUnique.mockResolvedValue({ textContent: "text content" });
    const contentHash = crypto.createHash("sha256").update("text content").digest("hex").slice(0, 32);
    const chunks = [
      {
        id: "chunk-3",
        content: "text content",
        contentHash,
        mediaUrls: [],
        embedding: [0.1], // non-null indicates already embedded
      },
    ];
    mockPrismaExecuteRawUnsafe.mockResolvedValueOnce(chunks);

    await embedChunksForFile({ fileAssetId: "file-1", apiKey: "sk-test" });

    expect(mockCreateMultiModalEmbedding).not.toHaveBeenCalled();
    expect(mockPrismaExecuteRawUnsafe).toHaveBeenCalledTimes(1);
  });
});
