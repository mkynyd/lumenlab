import { describe, expect, it, vi } from "vitest";

import {
  claimNotificationToasts,
  countUnread,
  encodeNotificationCursor,
  getOwnedNotification,
  listNotifications,
  listRecentNotifications,
  markNotificationsRead,
  parseNotificationCursor,
} from "./notification-store";

function row(overrides: Record<string, unknown> = {}) {
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

function client(overrides: Record<string, unknown> = {}) {
  return {
    notification: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      updateManyAndReturn: vi.fn().mockResolvedValue([]),
      ...overrides,
    },
    agentExecution: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
}

describe("通知数据访问", () => {
  it("游标可往返解析，非法游标抛错", () => {
    const cursor = encodeNotificationCursor({
      createdAt: new Date("2026-09-08T10:00:00.000Z"),
      id: "abc",
    });
    expect(cursor).toBe(`${new Date("2026-09-08T10:00:00.000Z").getTime()}:abc`);
    expect(parseNotificationCursor(cursor)).toEqual({
      createdAt: new Date("2026-09-08T10:00:00.000Z"),
      id: "abc",
    });
    expect(parseNotificationCursor(null)).toBeNull();
    expect(() => parseNotificationCursor("broken")).toThrow("无效的通知游标");
    expect(() => parseNotificationCursor("nope:abc")).toThrow("无效的通知游标");
    expect(() => parseNotificationCursor("12:")).toThrow("无效的通知游标");
  });

  it("分页返回 items、nextCursor 与未读数", async () => {
    const store = client({
      findMany: vi.fn().mockResolvedValue([
        row({ id: "n3" }),
        row({ id: "n2" }),
        row({ id: "n1" }),
      ]),
      count: vi.fn().mockResolvedValue(4),
    });

    const page = await listNotifications({
      userId: "user-1",
      limit: 2,
      client: store as never,
    });

    expect(store.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1" },
        take: 3,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      })
    );
    expect(page.items.map((item) => item.id)).toEqual(["n3", "n2"]);
    expect(page.nextCursor).toBe(
      `${new Date("2026-09-08T10:00:00.000Z").getTime()}:n2`
    );
    expect(page.unreadCount).toBe(4);
  });

  it("最后一页没有 nextCursor，未读筛选进入 where", async () => {
    const store = client({
      findMany: vi.fn().mockResolvedValue([row({ id: "n1" })]),
      count: vi.fn().mockResolvedValue(1),
    });

    const page = await listNotifications({
      userId: "user-1",
      filter: "unread",
      limit: 5,
      client: store as never,
    });

    expect(store.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1", readAt: null },
      })
    );
    expect(page.nextCursor).toBeNull();
  });

  it("游标翻页条件按 createdAt + id 稳定收敛", async () => {
    const store = client({
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    });
    const cursor = encodeNotificationCursor({
      createdAt: new Date("2026-09-08T10:00:00.000Z"),
      id: "n9",
    });

    await listNotifications({ userId: "user-1", cursor, client: store as never });

    expect(store.notification.findMany.mock.calls[0][0].where).toMatchObject({
      OR: [
        { createdAt: { lt: new Date("2026-09-08T10:00:00.000Z") } },
        { createdAt: new Date("2026-09-08T10:00:00.000Z"), id: { lt: "n9" } },
      ],
    });
  });

  it("最新一页用于订阅快照，未读数按用户统计", async () => {
    const store = client({
      findMany: vi.fn().mockResolvedValue([row()]),
      count: vi.fn().mockResolvedValue(2),
    });

    const items = await listRecentNotifications({
      userId: "user-1",
      limit: 1,
      client: store as never,
    });
    expect(items[0]).toMatchObject({ id: "n1", kind: "completed" });
    expect(await countUnread("user-1", store as never)).toBe(2);
    expect(store.notification.count).toHaveBeenCalledWith({
      where: { userId: "user-1", readAt: null },
    });
  });

  it("单条已读只更新自己的未读行", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const now = new Date("2026-09-08T11:00:00.000Z");
    const updated = await markNotificationsRead({
      userId: "user-1",
      ids: ["n1", "n2"],
      now,
      client: client({ updateMany }) as never,
    });

    expect(updated).toBe(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", readAt: null, id: { in: ["n1", "n2"] } },
      data: { readAt: now },
    });
  });

  it("全部已读不限制 id", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 7 });
    await markNotificationsRead({
      userId: "user-1",
      all: true,
      client: client({ updateMany }) as never,
    });

    expect(updateMany.mock.calls[0][0].where).toEqual({
      userId: "user-1",
      readAt: null,
    });
  });

  it("弹出认领是原子的，只返回未弹出的行", async () => {
    const updateManyAndReturn = vi
      .fn()
      .mockResolvedValue([{ id: "n2" }]);
    const now = new Date("2026-09-08T11:00:00.000Z");
    const claimed = await claimNotificationToasts({
      userId: "user-1",
      ids: ["n1", "n2"],
      now,
      client: client({ updateManyAndReturn }) as never,
    });

    expect(claimed).toEqual(["n2"]);
    expect(updateManyAndReturn).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        id: { in: ["n1", "n2"] },
        toastAcknowledgedAt: null,
      },
      data: { toastAcknowledgedAt: now },
      select: { id: true },
    });
  });

  it("空认领列表不访问数据库", async () => {
    const updateManyAndReturn = vi.fn();
    expect(
      await claimNotificationToasts({
        userId: "user-1",
        ids: [],
        client: client({ updateManyAndReturn }) as never,
      })
    ).toEqual([]);
    expect(updateManyAndReturn).not.toHaveBeenCalled();
  });

  it("读取时优先使用任务源的当前标题，避免停留在「新对话」", async () => {
    const store = client({
      findMany: vi.fn().mockResolvedValue([row({ title: "新对话" })]),
      count: vi.fn().mockResolvedValue(0),
    });
    store.agentExecution.findMany.mockResolvedValue([
      { id: "exec-1", conversation: { title: " 熵增定律三句话解释 " } },
    ]);

    const items = await listRecentNotifications({
      userId: "user-1",
      client: store as never,
    });

    expect(store.agentExecution.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["exec-1"] }, userId: "user-1" },
      select: { id: true, conversation: { select: { title: true } } },
    });
    expect(items[0].title).toBe("熵增定律三句话解释");
  });

  it("详情查询按用户与通知 ID 限定", async () => {
    const findFirst = vi.fn().mockResolvedValue(row());
    await getOwnedNotification({
      userId: "user-1",
      notificationId: "n1",
      client: client({ findFirst }) as never,
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: "n1", userId: "user-1" },
      select: expect.any(Object),
    });
  });
});
