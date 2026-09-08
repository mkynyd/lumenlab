import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  markNotificationsRead: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/notifications/notification-store", () => ({
  markNotificationsRead: mocks.markNotificationsRead,
}));

import { POST } from "./route";

function request(body: unknown) {
  return new NextRequest("http://localhost/api/notifications/read", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/notifications/read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.markNotificationsRead.mockResolvedValue(2);
  });

  it("未登录返回 401", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await POST(request({ ids: ["n1"] }))).status).toBe(401);
    expect(mocks.markNotificationsRead).not.toHaveBeenCalled();
  });

  it("按 ID 标记已读，过滤非法 ID", async () => {
    const response = await POST(request({ ids: ["n1", 7, "", "n2"] }));
    expect(mocks.markNotificationsRead).toHaveBeenCalledWith({
      userId: "user-1",
      ids: ["n1", "n2"],
      all: false,
    });
    await expect(response.json()).resolves.toEqual({ ok: true, updated: 2 });
  });

  it("all: true 表示全部已读", async () => {
    await POST(request({ all: true }));
    expect(mocks.markNotificationsRead).toHaveBeenCalledWith({
      userId: "user-1",
      ids: [],
      all: true,
    });
  });

  it("缺少 ids 且未全部已读返回 400", async () => {
    expect((await POST(request({ ids: [] }))).status).toBe(400);
    expect((await POST(request({}))).status).toBe(400);
  });

  it("超过 200 条返回 400", async () => {
    const ids = Array.from({ length: 201 }, (_, index) => `n${index}`);
    expect((await POST(request({ ids }))).status).toBe(400);
  });

  it("非 JSON 请求体返回 400", async () => {
    expect((await POST(request("not-json"))).status).toBe(400);
    expect((await POST(request("[1,2]"))).status).toBe(400);
  });
});
