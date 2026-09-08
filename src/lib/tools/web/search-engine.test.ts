import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { buildAnySearchResult, parseBingRssResults, parseDuckDuckGoResults, runWebSearch, softenExactDates } from "./search-engine";
import { AnySearchError, type AnySearchResponse } from "./anysearch";

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
    const result = await runWebSearch("");
    expect(result).toEqual({ summary: "", sources: [], query: "" });
  });

  it("returns cached result when available", async () => {
    const cached = {
      summary: "cached summary",
      sources: [{ url: "https://example.com" }],
      query: "test",
    };
    mockRedisGet.mockResolvedValue(JSON.stringify(cached));

    const result = await runWebSearch("test");
    expect(result).toEqual(cached);
  });

  it("returns verified HTTP search results without a nested model call", async () => {
    mockRedisGet.mockResolvedValue(null);

    const result = await runWebSearch("example");

    expect(result.summary).toContain("Verified snippet");
    expect(result.sources).toEqual([
      { url: "https://example.com/article", title: "Example & Article" },
    ]);
    expect(mockRedisSetex).toHaveBeenCalled();
  });

  it("returns an honest failure instead of a knowledge-only answer when no source exists", async () => {
    mockRedisGet.mockResolvedValue(null);
    vi.mocked(fetch).mockResolvedValue({ ok: true, text: async () => "no results" } as Response);

    const result = await runWebSearch("test");

    expect(result.sources).toEqual([]);
    expect(result.summary).toContain("未找到与问题相关的可验证结果");
  });

  it("drops irrelevant fallback results instead of feeding junk sources", async () => {
    mockRedisGet.mockResolvedValue(null);
    // 中文查询下 DDG/Bing 抓回的垃圾站结果（与查询无任何词项重合）
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      text: async () =>
        "<rss><channel><item><title>快递100-查快递,寄快递</title><link>https://junk.example.com/</link><description>快递单号查询</description></item></channel></rss>",
    } as Response);

    const result = await runWebSearch("编程语言排行榜");

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

    const result = await runWebSearch(
      "# 当前时间上下文\nsecret internal instruction\n\n# 用户问题\n\nOpenAI 官网"
    );

    expect(result.query).toBe("OpenAI 官网");
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain("OpenAI+%E5%AE%98%E7%BD%91");
    expect(String(vi.mocked(fetch).mock.calls[0][0])).not.toContain("secret");
  });

  it("removes interaction framing from the search query", async () => {
    mockRedisGet.mockResolvedValue(null);

    const result = await runWebSearch(
      "最终回归：联网查找 OpenAI 官方网站首页并附上来源。"
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

  it("falls back to DuckDuckGo after Bing times out and aborts", async () => {
    vi.useFakeTimers();
    mockRedisGet.mockResolvedValue(null);

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

    const resultPromise = runWebSearch("example");
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

describe("AnySearch provider chain", () => {
  const anysearchItems = (items: AnySearchResponse["items"]): AnySearchResponse => ({ items, requestId: "req-1" });

  beforeEach(() => {
    mockRedisGet.mockReset().mockResolvedValue(null);
    mockRedisSetex.mockReset();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => "no results" } as Response));
  });

  it("returns AnySearch results immediately and never calls Bing or DuckDuckGo", async () => {
    const anysearch = vi.fn().mockResolvedValue(anysearchItems([{ title: "T", url: "https://example.com/a", snippet: "S", content: "C" }]));
    const result = await runWebSearch("query", { maxResults: 3 }, { anysearchApiKey: "as_sk", anysearch });

    expect(result.sources).toEqual([{ url: "https://example.com/a", title: "T" }]);
    expect(result.summary).toContain("https://example.com/a");
    expect(anysearch).toHaveBeenCalledWith(expect.objectContaining({ query: "query", maxResults: 3, apiKey: "as_sk" }));
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("does not apply the literal relevance gate to AnySearch's own ranking", async () => {
    const anysearch = vi.fn().mockResolvedValue(anysearchItems([{ title: "完全无关的标题", url: "https://example.com/a", snippet: "无关摘要", content: "" }]));
    const result = await runWebSearch("编程语言排行榜", {}, { anysearchApiKey: "as_sk", anysearch });
    expect(result.sources).toHaveLength(1);
  });

  it("falls back to Bing when AnySearch returns no usable result", async () => {
    const anysearch = vi.fn().mockResolvedValue(anysearchItems([]));
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      text: async () => "<rss><channel><item><title>example</title><link>https://example.com/</link><description>example result</description></item></channel></rss>",
    } as Response);

    const result = await runWebSearch("example", {}, { anysearchApiKey: "as_sk", anysearch });
    expect(result.sources).toEqual([{ url: "https://example.com/", title: "example" }]);
    expect(anysearch).toHaveBeenCalledTimes(1);
  });

  it.each([400, 401, 402, 403, 503])("falls back after an AnySearch HTTP %i failure", async (status) => {
    const anysearch = vi.fn().mockRejectedValue(new AnySearchError(status >= 500 ? "server" : "request", status, "failed"));
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      text: async () => "<rss><channel><item><title>example</title><link>https://example.com/</link><description>example result</description></item></channel></rss>",
    } as Response);

    const result = await runWebSearch("example", {}, { anysearchApiKey: "as_sk", anysearch });
    expect(result.sources).toEqual([{ url: "https://example.com/", title: "example" }]);
  });

  it("skips AnySearch entirely when no platform key is configured", async () => {
    const anysearch = vi.fn();
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      text: async () => "<rss><channel><item><title>example</title><link>https://example.com/</link><description>example result</description></item></channel></rss>",
    } as Response);

    const result = await runWebSearch("example", {}, { anysearchApiKey: null, anysearch });
    expect(anysearch).not.toHaveBeenCalled();
    expect(result.sources).toHaveLength(1);
  });

  it("keeps tag/zone/language/params in the cache key", async () => {
    const anysearch = vi.fn().mockResolvedValue(anysearchItems([{ title: "T", url: "https://example.com/a", snippet: "", content: "" }]));
    await runWebSearch("query", { tag: "academic.search", zone: "intl", language: "en" }, { anysearchApiKey: "as_sk", anysearch });
    await runWebSearch("query", { tag: "code.doc" }, { anysearchApiKey: "as_sk", anysearch });

    const keys = mockRedisSetex.mock.calls.map((call) => String(call[0]));
    expect(new Set(keys).size).toBe(2);
    expect(keys[0]).toContain("websearch:v3:");
    expect(keys[0]).toContain("academic.search");
    expect(keys[0]).toContain("intl");
    expect(keys[1]).toContain("code.doc");
  });

  it("uses a bounded content excerpt when the snippet is missing", () => {
    const result = buildAnySearchResult(anysearchItems([{ title: "T", url: "https://example.com/a", snippet: "", content: "C".repeat(500) }]), "q");
    expect(result?.summary).toContain("C".repeat(200));
    expect(result?.summary).not.toContain("C".repeat(201));
  });

  it("keeps the legacy query + maxResults call shape working", async () => {
    const anysearch = vi.fn().mockResolvedValue(anysearchItems([{ title: "T", url: "https://example.com/a", snippet: "S", content: "" }]));
    const result = await runWebSearch("legacy query", { maxResults: 2 }, { anysearchApiKey: "as_sk", anysearch });
    expect(anysearch).toHaveBeenCalledWith(expect.objectContaining({ maxResults: 2 }));
    expect(result.sources).toHaveLength(1);
  });
});
