import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  buildNotificationSnapshot: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/notifications/snapshot", () => ({
  buildNotificationSnapshot: mocks.buildNotificationSnapshot,
}));

import { GET } from "./route";

describe("GET /api/notifications/snapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.buildNotificationSnapshot.mockResolvedValue({
      notifications: [],
      unreadCount: 0,
      tasks: [],
      version: "v1",
    });
  });

  it("未登录返回 401", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });

  it("返回当前用户的投影快照且不缓存", async () => {
    const response = await GET();
    expect(mocks.buildNotificationSnapshot).toHaveBeenCalledWith({
      userId: "user-1",
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      notifications: [],
      unreadCount: 0,
      tasks: [],
      version: "v1",
    });
  });
});
