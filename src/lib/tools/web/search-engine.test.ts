import { describe, expect, it, vi, beforeEach } from "vitest";
import { runWebSearch } from "./search-engine";
import * as deepseek from "@/lib/deepseek";

const mockRedisGet = vi.fn();
const mockRedisSetex = vi.fn();

vi.mock("@/lib/redis", () => ({
  getRedis: () => ({
    get: mockRedisGet,
    setex: mockRedisSetex,
  }),
}));

vi.mock("@/lib/deepseek", async (importOriginal) => {
  const original = await importOriginal<typeof deepseek>();
  return {
    ...original,
    completeChat: vi.fn(),
  };
});

function makeTextBlock(text: string) {
  return { type: "text", text };
}

function makeToolUseBlock(input: Record<string, unknown> = {}) {
  return { type: "tool_use", id: "tu-1", name: "web_search", input };
}

describe("runWebSearch", () => {
  beforeEach(() => {
    vi.mocked(deepseek.completeChat).mockReset();
    mockRedisGet.mockReset();
    mockRedisSetex.mockReset();
  });

  it("returns empty result for empty query", async () => {
    const result = await runWebSearch("", "sk-test");
    expect(result).toEqual({ summary: "", sources: [], query: "" });
    expect(deepseek.completeChat).not.toHaveBeenCalled();
  });

  it("returns cached result when available", async () => {
    const cached = {
      summary: "cached summary",
      sources: [{ url: "https://example.com" }],
      query: "test",
    };
    mockRedisGet.mockResolvedValue(JSON.stringify(cached));

    const result = await runWebSearch("test", "sk-test");
    expect(result).toEqual(cached);
    expect(deepseek.completeChat).not.toHaveBeenCalled();
  });

  it("extracts summary and sources from forced tool_choice response", async () => {
    mockRedisGet.mockResolvedValue(null);
    vi.mocked(deepseek.completeChat).mockResolvedValue({
      content: "According to [^1^], the answer is 42.",
      usage: null,
      rawContentBlocks: [
        makeToolUseBlock({
          sources: [
            { url: "https://example.com/article", title: "Example Article" },
          ],
        }),
        makeTextBlock("According to [^1^], the answer is 42."),
      ],
    });

    const result = await runWebSearch("what is the answer", "sk-test");

    expect(result.summary).toBe("According to [^1^], the answer is 42.");
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).toEqual({
      url: "https://example.com/article",
      title: "Example Article",
    });
    expect(result.query).toBe("what is the answer");
    expect(mockRedisSetex).toHaveBeenCalled();
  });

  it("falls back to regex URL extraction when tool_use has no sources", async () => {
    mockRedisGet.mockResolvedValue(null);
    vi.mocked(deepseek.completeChat).mockResolvedValue({
      content: "See https://example.com/foo and https://example.com/bar for details.",
      usage: null,
      rawContentBlocks: [makeToolUseBlock({ query: "test" })],
    });

    const result = await runWebSearch("test", "sk-test");

    expect(result.sources).toHaveLength(2);
    expect(result.sources.map((s) => s.url)).toContain("https://example.com/foo");
    expect(result.sources.map((s) => s.url)).toContain("https://example.com/bar");
  });

  it("falls back to normal chat when forced tool_choice throws", async () => {
    mockRedisGet.mockResolvedValue(null);
    vi.mocked(deepseek.completeChat)
      .mockRejectedValueOnce(new Error("tool_choice not supported"))
      .mockResolvedValueOnce({
        content: "Fallback answer based on knowledge.",
        usage: null,
        rawContentBlocks: [makeTextBlock("Fallback answer based on knowledge.")],
      });

    const result = await runWebSearch("test", "sk-test");

    expect(result.summary).toBe("Fallback answer based on knowledge.");
    expect(deepseek.completeChat).toHaveBeenCalledTimes(2);
  });

  it("uses completeChat with tool_choice forced to web_search", async () => {
    mockRedisGet.mockResolvedValue(null);
    vi.mocked(deepseek.completeChat).mockResolvedValue({
      content: "Answer.",
      usage: null,
      rawContentBlocks: [makeTextBlock("Answer.")],
    });

    await runWebSearch("query", "sk-test", 3);

    const lastCall = vi.mocked(deepseek.completeChat).mock.calls[0];
    expect(lastCall[1].tool_choice).toEqual({ type: "tool", name: "web_search" });
    expect(lastCall[1].tools).toEqual([
      {
        name: "web_search",
        description: "联网搜索关键词并返回摘要与来源",
        input_schema: {
          type: "object",
          properties: {
            query: { type: "string", description: "搜索关键词" },
          },
          required: ["query"],
        },
      },
    ]);
    expect(lastCall[1].thinking).toEqual({ type: "disabled" });
  });
});
