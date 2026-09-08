// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { ANYSEARCH_MAX_RESULTS_LIMIT, AnySearchError, buildAnySearchRequest, canonicalSearchUrl, clampAnySearchMaxResults, normalizeAnySearchItems, parseAnySearchResponse, requestAnySearch } from "./anysearch";

const successBody = (results: unknown[]) => ({ code: 0, message: "success", request_id: "req-1", data: { results, metadata: { total_results: results.length } } });
const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

describe("AnySearch request mapping", () => {
  it("maps camelCase options to the documented wire fields", () => {
    expect(buildAnySearchRequest({ query: "  transformer  ", maxResults: 3, tag: "academic.search", zone: "intl", language: "en", params: { year: 2026 } })).toEqual({
      query: "  transformer  ",
      max_results: 3,
      tag: "academic.search",
      zone: "intl",
      language: "en",
      params: { year: 2026 },
    });
  });

  it("omits optional fields that were not provided", () => {
    expect(buildAnySearchRequest({ query: "q" })).toEqual({ query: "q", max_results: 5 });
  });

  it("clamps max_results to the official 1-10 range", () => {
    expect(clampAnySearchMaxResults(0)).toBe(1);
    expect(clampAnySearchMaxResults(-3)).toBe(1);
    expect(clampAnySearchMaxResults(20)).toBe(ANYSEARCH_MAX_RESULTS_LIMIT);
    expect(clampAnySearchMaxResults(Number.NaN)).toBe(5);
    expect(clampAnySearchMaxResults(4)).toBe(4);
    expect(buildAnySearchRequest({ query: "q", maxResults: 99 }).max_results).toBe(10);
  });

  it("rejects an unknown zone instead of forwarding it", () => {
    expect(buildAnySearchRequest({ query: "q", zone: "us" as never })).toEqual({ query: "q", max_results: 5 });
  });
});

describe("AnySearch response parsing", () => {
  it("reads title/url/snippet/content and keeps the original URL", () => {
    const parsed = parseAnySearchResponse(successBody([{ title: "T", url: "https://example.com/a", snippet: "S", content: "C" }]));
    expect(parsed.requestId).toBe("req-1");
    expect(parsed.items).toEqual([{ title: "T", url: "https://example.com/a", snippet: "S", content: "C" }]);
  });

  it("filters malformed and non-http URLs and de-duplicates canonical URLs", () => {
    const items = normalizeAnySearchItems({ results: [
      { title: "keep", url: "https://example.com/a" },
      { title: "dupe", url: "https://example.com/a#fragment" },
      { title: "javascript", url: "javascript:alert(1)" },
      { title: "file", url: "file:///etc/passwd" },
      { title: "credentials", url: "https://user:pass@example.com/x" },
      { title: "broken", url: "not a url" },
      { title: "second", url: "http://other.example.org/b" },
      null,
    ] }, 10);
    expect(items.map((item) => item.url)).toEqual(["https://example.com/a", "http://other.example.org/b"]);
  });

  it("honours the requested limit and falls back to the URL as title", () => {
    const items = normalizeAnySearchItems({ results: [{ url: "https://example.com/a" }, { url: "https://example.com/b" }] }, 1);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("https://example.com/a");
  });

  it("rejects non-zero business codes and malformed envelopes", () => {
    expect(() => parseAnySearchResponse({ code: -1, message: "bad" })).toThrow(AnySearchError);
    expect(() => parseAnySearchResponse("nope")).toThrow(AnySearchError);
  });

  it("normalizes canonical URLs", () => {
    expect(canonicalSearchUrl("HTTPS://Example.COM/a/?q=1#x")).toBe("https://example.com/a?q=1");
    expect(canonicalSearchUrl("ftp://example.com/a")).toBeNull();
  });
});

describe("AnySearch transport", () => {
  it("sends the Bearer key and JSON body to the official endpoint", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(successBody([{ title: "T", url: "https://example.com/a", snippet: "S" }])));
    const result = await requestAnySearch({ query: "q", maxResults: 2, apiKey: "as_sk_test", fetchImpl });

    expect(result.items).toHaveLength(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.anysearch.com/v1/search");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer as_sk_test");
    expect(JSON.parse(String(init.body))).toEqual({ query: "q", max_results: 2 });
  });

  it.each([[400, "request"], [401, "auth"], [402, "quota"], [403, "auth"]])("maps HTTP %i to a %s failure without retrying", async (status, kind) => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: "x" }, status));
    await expect(requestAnySearch({ query: "q", apiKey: "k", fetchImpl })).rejects.toMatchObject({ kind, status });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries 429 once within the bounded wait and then succeeds", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: "slow down" }, 429, { "retry-after": "0" }))
      .mockResolvedValueOnce(jsonResponse(successBody([{ title: "T", url: "https://example.com/a" }])));
    const result = await requestAnySearch({ query: "q", apiKey: "k", fetchImpl });
    expect(result.items).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not wait for an unreasonably long Retry-After", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: "quota" }, 429, { "retry-after": "3600" }));
      const promise = requestAnySearch({ query: "q", apiKey: "k", fetchImpl }).catch((error) => error);
      await vi.advanceTimersByTimeAsync(1_000);
      const error = await promise;
      expect(error).toMatchObject({ kind: "rate_limit", status: 429, retryAfterMs: 3_600_000 });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries a 5xx once and surfaces the failure when it persists", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: "boom" }, 503));
    await expect(requestAnySearch({ query: "q", apiKey: "k", fetchImpl })).rejects.toMatchObject({ kind: "server", status: 503 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries a network failure once and never loops", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    await expect(requestAnySearch({ query: "q", apiKey: "k", fetchImpl })).rejects.toMatchObject({ kind: "network" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
