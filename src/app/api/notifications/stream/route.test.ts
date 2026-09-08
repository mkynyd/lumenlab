import { NextRequest } from "next/server";
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

async function readFirstEvent(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("no body");
  const { value } = await reader.read();
  await reader.cancel();
  return new TextDecoder().decode(value);
}

describe("GET /api/notifications/stream", () => {
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
    const response = await GET(
      new NextRequest("http://localhost/api/notifications/stream")
    );
    expect(response.status).toBe(401);
  });

  it("以 SSE 推送当前用户的权威快照", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/notifications/stream")
    );

    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toContain("no-store");
    const first = await readFirstEvent(response);
    expect(first).toContain(": connected");
    // 首个快照事件在下一个 tick 推送，这里等待一次快照调用。
    await vi.waitFor(() => {
      expect(mocks.buildNotificationSnapshot).toHaveBeenCalledWith({
        userId: "user-1",
      });
    });
  });
});
