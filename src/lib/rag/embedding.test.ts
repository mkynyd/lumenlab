import { describe, it, expect, vi, beforeEach } from "vitest";
import { embedQuery, embedTexts, EMBEDDING_DIM, EMBEDDING_MODEL } from "./embedding";

const mockCreateMultiModalEmbedding = vi.fn();

vi.mock("dashscope-sdk-official", () => ({
  Configuration: class {},
  DashscopeApi: class {
    createMultiModalEmbedding = mockCreateMultiModalEmbedding;
  },
}));

describe("embedding", () => {
  beforeEach(() => {
    mockCreateMultiModalEmbedding.mockReset();
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
});
