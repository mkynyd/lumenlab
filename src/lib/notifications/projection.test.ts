import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executionFindMany: vi.fn(),
  notificationCreateMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    agentExecution: { findMany: mocks.executionFindMany },
    notification: { createMany: mocks.notificationCreateMany },
  },
}));

import {
  agentExecutionNotificationKind,
  agentExecutionTargetPath,
  buildAgentExecutionNotification,
  notifyAgentExecutionTransition,
  reconcileAgentExecutionNotifications,
  upsertTaskNotification,
} from "./projection";

function notificationClient(createMany = vi.fn().mockResolvedValue({ count: 1 })) {
  return { notification: { createMany } } as never;
}

describe("通知投影", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("幂等写入：重复 eventKey 由唯一约束跳过，不覆盖已读/已弹出状态", async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 0 });
    const created = await upsertTaskNotification(notificationClient(createMany), {
      userId: "user-1",
      taskType: "agent_execution",
      taskId: "exec-1",
      taskAttempt: 1,
      kind: "completed",
      title: "标题",
      summary: "已完成",
      targetPath: "/chat/conv-1",
      createdAt: new Date("2026-09-08T10:00:00.000Z"),
    });

    expect(created).toBe(false);
    expect(createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          userId: "user-1",
          eventKey: "agent_execution:exec-1:1:completed",
          kind: "completed",
          title: "标题",
          summary: "已完成",
          targetPath: "/chat/conv-1",
          createdAt: new Date("2026-09-08T10:00:00.000Z"),
        }),
      ],
      skipDuplicates: true,
    });
  });

  it("用户主动取消时直接标记已弹出，只进列表不弹窗", async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const now = new Date("2026-09-08T10:00:00.000Z");
    await upsertTaskNotification(notificationClient(createMany), {
      userId: "user-1",
      taskType: "agent_execution",
      taskId: "exec-1",
      taskAttempt: 1,
      kind: "cancelled",
      title: "标题",
      toastAcknowledgedAt: now,
    });

    expect(createMany.mock.calls[0][0].data[0]).toMatchObject({
      toastAcknowledgedAt: now,
    });
  });

  it("非法路径不会写入通知行", async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    await upsertTaskNotification(notificationClient(createMany), {
      userId: "user-1",
      taskType: "agent_execution",
      taskId: "exec-1",
      taskAttempt: 1,
      kind: "completed",
      title: "标题",
      targetPath: "//evil.example.com",
    });

    expect(createMany.mock.calls[0][0].data[0].targetPath).toBeNull();
  });

  it("状态到通知类型的映射覆盖终态与等待态", () => {
    expect(agentExecutionNotificationKind("waiting_approval")).toBe("waiting_user");
    expect(agentExecutionNotificationKind("completed")).toBe("completed");
    expect(agentExecutionNotificationKind("failed")).toBe("failed");
    expect(agentExecutionNotificationKind("cancelled")).toBe("cancelled");
    expect(agentExecutionNotificationKind("running")).toBeNull();
    expect(agentExecutionNotificationKind("queued")).toBeNull();
  });

  it("结果路径按会话归属生成，项目会话回到项目页", () => {
    expect(
      agentExecutionTargetPath({ conversationId: "conv-1", projectId: null })
    ).toBe("/chat/conv-1");
    expect(
      agentExecutionTargetPath({ conversationId: "conv-1", projectId: "proj-1" })
    ).toBe("/projects/proj-1");
  });

  it("标题取会话标题，空标题回退为通用文案", () => {
    const base = {
      id: "exec-1",
      userId: "user-1",
      attempt: 1,
      conversationId: "conv-1",
      projectId: null,
    };
    expect(
      buildAgentExecutionNotification(
        { ...base, conversation: { title: " 积分推导 " } },
        "completed"
      )
    ).toMatchObject({ title: "积分推导", summary: "回答已完成，点击查看结果" });
    expect(
      buildAgentExecutionNotification({ ...base, conversation: null }, "failed")
    ).toMatchObject({ title: "对话任务", summary: "执行失败，可在对话中重试" });
  });

  it("事务内投影读取归属字段后写入", async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const findUnique = vi.fn().mockResolvedValue({
      id: "exec-1",
      userId: "user-1",
      attempt: 2,
      conversationId: "conv-1",
      projectId: null,
      conversation: { title: "标题" },
    });

    const created = await notifyAgentExecutionTransition(
      {
        notification: { createMany },
        agentExecution: { findUnique },
      } as never,
      { executionId: "exec-1", kind: "waiting_user", now: new Date("2026-09-08T10:00:00.000Z") }
    );

    expect(created).toBe(true);
    expect(createMany.mock.calls[0][0].data[0]).toMatchObject({
      eventKey: "agent_execution:exec-1:2:waiting_user",
      taskAttempt: 2,
      targetPath: "/chat/conv-1",
    });
  });

  it("执行不存在时不写通知", async () => {
    const createMany = vi.fn();
    const created = await notifyAgentExecutionTransition(
      {
        notification: { createMany },
        agentExecution: { findUnique: vi.fn().mockResolvedValue(null) },
      } as never,
      { executionId: "exec-x", kind: "completed" }
    );

    expect(created).toBe(false);
    expect(createMany).not.toHaveBeenCalled();
  });

  it("补齐扫描近期终态执行并可重复执行", async () => {
    mocks.executionFindMany.mockResolvedValue([
      {
        id: "exec-1",
        userId: "user-1",
        attempt: 1,
        status: "completed",
        conversationId: "conv-1",
        projectId: null,
        conversation: { title: "标题" },
      },
      {
        id: "exec-2",
        userId: "user-1",
        attempt: 1,
        status: "running",
        conversationId: "conv-2",
        projectId: null,
        conversation: { title: "标题" },
      },
    ]);
    mocks.notificationCreateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const first = await reconcileAgentExecutionNotifications({ userId: "user-1" });
    expect(first).toEqual({ scanned: 2, created: 1 });
    // 第二遍：同样的执行再扫一次，唯一键让投影不再新建。
    const second = await reconcileAgentExecutionNotifications({ userId: "user-1" });
    expect(second).toEqual({ scanned: 2, created: 0 });
    expect(mocks.executionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "user-1",
          status: { in: ["waiting_approval", "completed", "failed", "cancelled"] },
        }),
      })
    );
  });
});
