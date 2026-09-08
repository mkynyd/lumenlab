import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  listNotifications: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/notifications/notification-store", () => ({
  listNotifications: mocks.listNotifications,
}));

import { GET } from "./route";

describe("GET /api/notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.listNotifications.mockResolvedValue({
      items: [],
      nextCursor: null,
      unreadCount: 0,
    });
  });

  it("未登录返回 401 且不查询", async () => {
    mocks.auth.mockResolvedValue(null);
    const response = await GET(new NextRequest("http://localhost/api/notifications"));
    expect(response.status).toBe(401);
    expect(mocks.listNotifications).not.toHaveBeenCalled();
  });

  it("按会话用户读取列表并解析筛选、游标与数量", async () => {
    const response = await GET(
      new NextRequest(
        "http://localhost/api/notifications?filter=unread&limit=5&cursor=123:n1"
      )
    );

    expect(mocks.listNotifications).toHaveBeenCalledWith({
      userId: "user-1",
      filter: "unread",
      cursor: "123:n1",
      limit: 5,
    });
    expect(response.status).toBe(200);
  });

  it("非法游标返回 400", async () => {
    mocks.listNotifications.mockRejectedValue(new Error("无效的通知游标"));
    const response = await GET(
      new NextRequest("http://localhost/api/notifications?cursor=broken")
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "无效的通知游标" });
  });

  it("未知筛选值退化为全部", async () => {
    await GET(new NextRequest("http://localhost/api/notifications?filter=weird"));
    expect(mocks.listNotifications).toHaveBeenCalledWith(
      expect.objectContaining({ filter: "all" })
    );
  });
});
