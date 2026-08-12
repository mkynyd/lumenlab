import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { parseBingRssResults, parseDuckDuckGoResults, runWebSearch, softenExactDates } from "./search-engine";
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

describe("softenExactDates", () => {
  const now = new Date("2026-08-13T12:00:00Z");

  it("rewrites dates near today to 最新", () => {
    expect(softenExactDates("2026年8月13日重庆气温", now)).toBe("最新重庆气温");
    expect(softenExactDates("重庆 2026-08-12 天气", now)).toBe("重庆 最新 天气");
    expect(softenExactDates("2026/8/14 的新闻", now)).toBe("最新 的新闻");
  });

  it("keeps dates far from today intact", () => {
    expect(softenExactDates("2026年1月1日发生了什么", now)).toBe(
      "2026年1月1日发生了什么"
    );
    expect(softenExactDates("2025-08-13 的历史", now)).toBe("2025-08-13 的历史");
  });

  it("rejects invalid calendar dates", () => {
    expect(softenExactDates("2026年13月40日", now)).toBe("2026年13月40日");
  });
});

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

  afterEach(() => {
    vi.useRealTimers();
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

    const result = await runWebSearch("example", "sk-test");

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
    expect(result.summary).toContain("未找到与问题相关的可验证结果");
  });

  it("drops irrelevant fallback results instead of feeding junk sources", async () => {
    mockRedisGet.mockResolvedValue(null);
    vi.mocked(deepseek.completeChat).mockRejectedValue(new Error("unsupported"));
    // 中文查询下 DDG/Bing 抓回的垃圾站结果（与查询无任何词项重合）
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      text: async () =>
        "<rss><channel><item><title>快递100-查快递,寄快递</title><link>https://junk.example.com/</link><description>快递单号查询</description></item></channel></rss>",
    } as Response);

    const result = await runWebSearch("编程语言排行榜", "sk-test");

    expect(result.sources).toEqual([]);
    expect(result.summary).toContain("未找到与问题相关的可验证结果");
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

  it("calls completeChat without forcing tool_choice on DeepSeek", async () => {
    mockRedisGet.mockResolvedValue(null);
    vi.mocked(deepseek.completeChat).mockResolvedValue({
      content: "Answer.",
      usage: null,
      rawContentBlocks: [makeTextBlock("Answer.")],
    });

    await runWebSearch("query", "sk-test", 3);

    const lastCall = vi.mocked(deepseek.completeChat).mock.calls[0];
    // DeepSeek 内置 web_search 是 server tool，按 name 强制 tool_choice 会 400，
    // 因此不传强制 tool_choice，靠系统提示驱动模型调用。
    expect(lastCall[1].tool_choice).toBeUndefined();
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

  it("falls back to DuckDuckGo after Bing times out and aborts", async () => {
    vi.useFakeTimers();
    mockRedisGet.mockResolvedValue(null);
    vi.mocked(deepseek.completeChat).mockRejectedValue(new Error("unsupported"));

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockReset();
    fetchMock
      .mockImplementationOnce(async (_url, init) => {
        // 模拟 Bing 挂起直到 10s 超时 abort。
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        });
      })
      .mockImplementationOnce(async (_url, init) => {
        // 若 signal 已被上一次超时 abort（修复前的连坐 bug），fetch 应抛 AbortError。
        if (init?.signal?.aborted) {
          throw new DOMException("The operation was aborted.", "AbortError");
        }
        return {
          ok: true,
          text: async () => verifiedSearchHtml,
        } as Response;
      });

    const resultPromise = runWebSearch("example", "sk-test");
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await resultPromise;

    expect(result.summary).toContain("Verified snippet");
    expect(result.sources).toEqual([
      { url: "https://example.com/article", title: "Example & Article" },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain("duckduckgo.com");
  });
});
