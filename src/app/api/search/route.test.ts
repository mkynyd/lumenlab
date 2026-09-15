// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  searchGlobal: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/search/global-search", () => ({
  searchGlobal: mocks.searchGlobal,
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: mocks.loggerError, warn: vi.fn(), info: vi.fn() },
}));

import { GET } from "./route";

function request(query = "") {
  return new Request(`http://localhost/api/search${query}`);
}

describe("GET /api/search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.searchGlobal.mockResolvedValue({
      query: "数学",
      results: [{ id: "chat-1", type: "conversation", title: "数学复习" }],
      counts: { conversation: 1, image: 0, document: 0, project: 0 },
    });
  });

  it("requires authentication before searching", async () => {
    mocks.auth.mockResolvedValue(null);
    const response = await GET(request("?q=数学"));

    expect(response.status).toBe(401);
    expect(mocks.searchGlobal).not.toHaveBeenCalled();
  });

  it("passes the normalized query and authenticated user boundary", async () => {
    const response = await GET(request("?q=%20%E6%95%B0%E5%AD%A6%20"));

    expect(response.status).toBe(200);
    expect(mocks.searchGlobal).toHaveBeenCalledWith({
      userId: "user-1",
      query: "数学",
    });
  });

  it("returns an empty response without querying for blank input", async () => {
    const response = await GET(request("?q=%20%20"));

    expect(response.status).toBe(200);
    expect(mocks.searchGlobal).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ results: [] });
  });

  it("rejects overlong input", async () => {
    const response = await GET(request(`?q=${"a".repeat(101)}`));

    expect(response.status).toBe(400);
    expect(mocks.searchGlobal).not.toHaveBeenCalled();
  });

  it("returns a safe error while logging server failures", async () => {
    mocks.searchGlobal.mockRejectedValue(new Error("database unavailable"));
    const response = await GET(request("?q=数学"));

    expect(response.status).toBe(500);
    expect(mocks.loggerError).toHaveBeenCalledWith(
      "全局搜索失败",
      expect.objectContaining({ userId: "user-1" })
    );
    await expect(response.json()).resolves.toEqual({
      error: "搜索失败，请稍后重试",
    });
  });
});
