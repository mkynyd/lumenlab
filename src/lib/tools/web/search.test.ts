import { describe, expect, it, vi, beforeEach } from "vitest";
import { webSearch } from "./search";
import * as searchEngine from "./search-engine";

vi.mock("@/lib/tools/web/search-engine", () => ({
  runWebSearch: vi.fn(),
}));

const mockCtx = {
  userId: "user-1",
  conversationId: "conv-1",
};

describe("webSearch tool", () => {
  beforeEach(() => {
    vi.mocked(searchEngine.runWebSearch).mockReset();
    delete process.env.ANYSEARCH_API_KEY;
  });

  it("returns empty result for empty query", async () => {
    const result = await webSearch(mockCtx, "   ");
    expect(result).toEqual({ summary: "", sources: [], query: "" });
    expect(searchEngine.runWebSearch).not.toHaveBeenCalled();
  });

  it("delegates to the platform search stack with the requested options", async () => {
    vi.mocked(searchEngine.runWebSearch).mockResolvedValue({
      summary: "result",
      sources: [{ url: "https://example.com" }],
      query: "query",
    });

    const result = await webSearch(mockCtx, "query", { maxResults: 3, tag: "academic.search", zone: "intl", language: "en", params: { year: 2026 } });

    expect(searchEngine.runWebSearch).toHaveBeenCalledWith("query", { maxResults: 3, tag: "academic.search", zone: "intl", language: "en", params: { year: 2026 } }, { anysearchApiKey: null });
    expect(result.summary).toBe("result");
  });

  it("passes the platform AnySearch key when configured and never a model provider key", async () => {
    process.env.ANYSEARCH_API_KEY = "as_sk_platform";
    vi.mocked(searchEngine.runWebSearch).mockResolvedValue({ summary: "ok", sources: [], query: "q" });

    await webSearch(mockCtx, "q");

    expect(searchEngine.runWebSearch).toHaveBeenCalledWith("q", {}, { anysearchApiKey: "as_sk_platform" });
  });

  it("truncates query to 500 chars", async () => {
    vi.mocked(searchEngine.runWebSearch).mockResolvedValue({
      summary: "ok",
      sources: [],
      query: "x",
    });

    await webSearch(mockCtx, "x".repeat(1000));

    expect(searchEngine.runWebSearch).toHaveBeenCalledWith("x".repeat(500), {}, { anysearchApiKey: null });
  });
});
