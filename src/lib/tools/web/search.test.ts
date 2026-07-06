import { describe, expect, it, vi, beforeEach } from "vitest";
import { webSearch } from "./search";
import * as searchEngine from "./search-engine";
import * as providerAccess from "@/lib/data/provider-access";
import { ProviderAccessError } from "@/lib/provider-access";

vi.mock("@/lib/tools/web/search-engine", () => ({
  runWebSearch: vi.fn(),
}));

vi.mock("@/lib/data/provider-access", () => ({
  getProviderApiKey: vi.fn(),
}));

const mockCtx = {
  userId: "user-1",
  conversationId: "conv-1",
};

describe("webSearch tool", () => {
  beforeEach(() => {
    vi.mocked(providerAccess.getProviderApiKey).mockReset();
    vi.mocked(searchEngine.runWebSearch).mockReset();
  });

  it("returns empty result for empty query", async () => {
    const result = await webSearch(mockCtx, "   ");
    expect(result).toEqual({ summary: "", sources: [], query: "" });
    expect(providerAccess.getProviderApiKey).not.toHaveBeenCalled();
  });

  it("resolves DeepSeek key and delegates to runWebSearch", async () => {
    vi.mocked(providerAccess.getProviderApiKey).mockResolvedValue("sk-deepseek");
    vi.mocked(searchEngine.runWebSearch).mockResolvedValue({
      summary: "result",
      sources: [{ url: "https://example.com" }],
      query: "query",
    });

    const result = await webSearch(mockCtx, "query", 3);

    expect(providerAccess.getProviderApiKey).toHaveBeenCalledWith("user-1", "deepseek");
    expect(searchEngine.runWebSearch).toHaveBeenCalledWith("query", "sk-deepseek", 3);
    expect(result.summary).toBe("result");
  });

  it("throws descriptive error when DeepSeek credential is missing", async () => {
    vi.mocked(providerAccess.getProviderApiKey).mockRejectedValue(
      new ProviderAccessError("credential_unavailable", "无可用凭证")
    );

    await expect(webSearch(mockCtx, "query")).rejects.toThrow(
      /联网搜索需要 DeepSeek 服务配置/
    );
  });

  it("truncates query to 500 chars", async () => {
    vi.mocked(providerAccess.getProviderApiKey).mockResolvedValue("sk-deepseek");
    vi.mocked(searchEngine.runWebSearch).mockResolvedValue({
      summary: "ok",
      sources: [],
      query: "x",
    });

    const longQuery = "x".repeat(1000);
    await webSearch(mockCtx, longQuery);

    expect(searchEngine.runWebSearch).toHaveBeenCalledWith(
      "x".repeat(500),
      "sk-deepseek",
      5
    );
  });
});
