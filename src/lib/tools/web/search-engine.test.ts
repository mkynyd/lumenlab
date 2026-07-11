import { describe, expect, it, vi, beforeEach } from "vitest";
import { parseBingRssResults, parseDuckDuckGoResults, runWebSearch } from "./search-engine";
import * as deepseek from "@/lib/deepseek";

const mockRedisGet = vi.fn();
const mockRedisSetex = vi.fn();
const verifiedSearchHtml = `<div class="result results_links results_links_deep web-result">
  <div class="links_main links_deep result__body">
    <h2><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Farticle&amp;rut=x">Example &amp; Article</a></h2>
    <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Farticle&amp;rut=x">Verified <b>snippet</b>.</a>
  </div>
</div>`;

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
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      text: async () => verifiedSearchHtml,
    }));
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

  it("falls back to verified HTTP search when forced tool_choice throws", async () => {
    mockRedisGet.mockResolvedValue(null);
    vi.mocked(deepseek.completeChat)
      .mockRejectedValueOnce(new Error("tool_choice not supported"));

    const result = await runWebSearch("test", "sk-test");

    expect(result.summary).toContain("Verified snippet");
    expect(result.sources).toEqual([
      { url: "https://example.com/article", title: "Example & Article" },
    ]);
    expect(deepseek.completeChat).toHaveBeenCalledTimes(1);
  });

  it("returns an honest failure instead of a knowledge-only answer when no source exists", async () => {
    mockRedisGet.mockResolvedValue(null);
    vi.mocked(deepseek.completeChat).mockRejectedValue(new Error("unsupported"));
    vi.mocked(fetch).mockResolvedValue({ ok: true, text: async () => "no results" } as Response);

    const result = await runWebSearch("test", "sk-test");

    expect(result.sources).toEqual([]);
    expect(result.summary).toContain("未找到可验证结果");
  });

  it("parses and limits verified DuckDuckGo results", () => {
    expect(parseDuckDuckGoResults(verifiedSearchHtml, 1)).toEqual([
      {
        title: "Example & Article",
        url: "https://example.com/article",
        snippet: "Verified snippet.",
      },
    ]);
  });

  it("does not send hidden time context to the external search provider", async () => {
    mockRedisGet.mockResolvedValue(null);
    vi.mocked(deepseek.completeChat).mockRejectedValue(new Error("unsupported"));

    const result = await runWebSearch(
      "# 当前时间上下文\nsecret internal instruction\n\n# 用户问题\n\nOpenAI 官网",
      "sk-test"
    );

    expect(result.query).toBe("OpenAI 官网");
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain("OpenAI+%E5%AE%98%E7%BD%91");
    expect(String(vi.mocked(fetch).mock.calls[0][0])).not.toContain("secret");
  });

  it("removes interaction framing from the search query", async () => {
    mockRedisGet.mockResolvedValue(null);
    vi.mocked(deepseek.completeChat).mockRejectedValue(new Error("unsupported"));

    const result = await runWebSearch(
      "最终回归：联网查找 OpenAI 官方网站首页并附上来源。",
      "sk-test"
    );

    expect(result.query).toBe("OpenAI 官方网站首页");
  });

  it("parses verified Bing RSS results", () => {
    expect(parseBingRssResults(
      "<rss><channel><item><title>Official Site</title><link>https://example.com/</link><description>Verified result</description></item></channel></rss>",
      1
    )).toEqual([
      { title: "Official Site", url: "https://example.com/", snippet: "Verified result" },
    ]);
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
