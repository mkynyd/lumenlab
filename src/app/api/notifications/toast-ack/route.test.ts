import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  claimNotificationToasts: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/notifications/notification-store", () => ({
  claimNotificationToasts: mocks.claimNotificationToasts,
}));

import { POST } from "./route";

function request(body: unknown) {
  return new NextRequest("http://localhost/api/notifications/toast-ack", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/notifications/toast-ack", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.claimNotificationToasts.mockResolvedValue(["n2"]);
  });

  it("未登录返回 401", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await POST(request({ ids: ["n1"] }))).status).toBe(401);
  });

  it("返回本标签页真正认领到的 ID", async () => {
    const response = await POST(request({ ids: ["n1", "n2"] }));
    expect(mocks.claimNotificationToasts).toHaveBeenCalledWith({
      userId: "user-1",
      ids: ["n1", "n2"],
    });
    await expect(response.json()).resolves.toEqual({ ok: true, claimed: ["n2"] });
  });

  it("空 ids 或超过 50 条返回 400", async () => {
    expect((await POST(request({ ids: [] }))).status).toBe(400);
    const ids = Array.from({ length: 51 }, (_, index) => `n${index}`);
    expect((await POST(request({ ids }))).status).toBe(400);
  });
});
