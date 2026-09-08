import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getOwnedNotification: vi.fn(),
  getOwned: vi.fn(),
  getTaskSource: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/notifications/notification-store", () => ({
  getOwnedNotification: mocks.getOwnedNotification,
}));
vi.mock("@/lib/tasks/registry", () => ({
  getTaskSource: mocks.getTaskSource,
}));

import { GET } from "./route";

function notificationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "n1",
    taskType: "agent_execution",
    taskId: "exec-1",
    kind: "completed",
    title: "标题",
    summary: "已完成",
    targetPath: "/chat/conv-1",
    createdAt: new Date("2026-09-08T10:00:00.000Z"),
    readAt: null,
    toastAcknowledgedAt: null,
    ...overrides,
  };
}

function call(id = "n1") {
  return GET(new NextRequest(`http://localhost/api/notifications/${id}`), {
    params: Promise.resolve({ id }),
  });
}

describe("GET /api/notifications/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.getOwnedNotification.mockResolvedValue(notificationRow());
    mocks.getTaskSource.mockReturnValue({ getOwned: mocks.getOwned });
    mocks.getOwned.mockResolvedValue({
      taskId: "exec-1",
      taskType: "agent_execution",
      resultPath: "/chat/conv-1",
    });
  });

  it("未登录返回 401", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
  });

  it("他人或不存在返回 404", async () => {
    mocks.getOwnedNotification.mockResolvedValue(null);
    const response = await call();
    expect(response.status).toBe(404);
    expect(mocks.getOwnedNotification).toHaveBeenCalledWith({
      userId: "user-1",
      notificationId: "n1",
    });
  });

  it("重新鉴权后返回服务器生成的站内路径", async () => {
    const response = await call();
    expect(mocks.getOwned).toHaveBeenCalledWith({
      userId: "user-1",
      taskId: "exec-1",
    });
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      targetPath: "/chat/conv-1",
    });
  });

  it("任务已被删除时回退到通知里的路径", async () => {
    mocks.getOwned.mockResolvedValue(null);
    const response = await call();
    await expect(response.json()).resolves.toMatchObject({
      targetPath: "/chat/conv-1",
    });
  });

  it("任务与通知都拿不到可访问路径时返回 410", async () => {
    mocks.getOwned.mockResolvedValue(null);
    mocks.getOwnedNotification.mockResolvedValue(
      notificationRow({ targetPath: "//evil.example.com" })
    );
    expect((await call()).status).toBe(410);
  });

  it("未知任务源时使用通知自身的路径", async () => {
    mocks.getTaskSource.mockReturnValue(undefined);
    const response = await call();
    await expect(response.json()).resolves.toMatchObject({
      targetPath: "/chat/conv-1",
    });
  });
});
