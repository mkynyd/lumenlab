import { describe, expect, it, vi } from "vitest";

import {
  AGENT_EXECUTION_USER_RETRY_MAX_ATTEMPTS,
  AgentExecutionTaskSource,
  toTaskStatus,
} from "./agent-execution-source";

function fakeClient() {
  return {
    agentExecution: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
  };
}

type Client = ReturnType<typeof fakeClient>;

function sourceWith(client: Client) {
  return new AgentExecutionTaskSource(
    client as unknown as ConstructorParameters<typeof AgentExecutionTaskSource>[0]
  );
}

describe("AgentExecutionTaskSource", () => {
  it("把 waiting_approval 映射为等待用户，其余状态原样保留", () => {
    expect(toTaskStatus("waiting_approval")).toBe("waiting_user");
    expect(toTaskStatus("running")).toBe("running");
    expect(toTaskStatus("completed")).toBe("completed");
  });

  it("只查询当前用户的进行中执行，并给出阶段与已完成单元数", async () => {
    const client = fakeClient();
    client.agentExecution.findMany
      .mockResolvedValueOnce([
        {
          id: "exec-1",
          status: "running",
          attempt: 1,
          updatedAt: new Date("2026-09-08T10:00:00.000Z"),
          conversationId: "conv-1",
          projectId: null,
          conversation: { title: "积分推导" },
          _count: { toolExecutions: 2 },
        },
        {
          id: "exec-2",
          status: "waiting_approval",
          attempt: 2,
          updatedAt: new Date("2026-09-08T09:00:00.000Z"),
          conversationId: "conv-2",
          projectId: "proj-1",
          conversation: { title: "   " },
          _count: { toolExecutions: 0 },
        },
      ])
      .mockResolvedValueOnce([{ id: "exec-1", _count: { toolExecutions: 1 } }]);

    const tasks = await sourceWith(client).listActive({
      userId: "user-1",
      limit: 5,
    });

    expect(client.agentExecution.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          userId: "user-1",
          status: { in: ["queued", "running", "waiting_approval"] },
        },
        take: 5,
      })
    );
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toMatchObject({
      taskId: "exec-1",
      taskType: "agent_execution",
      title: "积分推导",
      status: "running",
      stage: "正在执行工具",
      completedUnits: 2,
      totalUnits: null,
      resultPath: "/chat/conv-1",
      canCancel: true,
      canRetry: false,
    });
    expect(tasks[0].updatedAt).toBe("2026-09-08T10:00:00.000Z");
    expect(tasks[1]).toMatchObject({
      title: "对话任务",
      status: "waiting_user",
      stage: "等待你的确认",
      resultPath: "/projects/proj-1",
    });
  });

  it("没有进行中任务时不再查询工具执行", async () => {
    const client = fakeClient();
    client.agentExecution.findMany.mockResolvedValueOnce([]);

    expect(await sourceWith(client).listActive({ userId: "user-1" })).toEqual([]);
    expect(client.agentExecution.findMany).toHaveBeenCalledTimes(1);
  });

  it("按归属读取单个任务，并计算可重试与可取消", async () => {
    const client = fakeClient();
    client.agentExecution.findFirst
      .mockResolvedValueOnce({
        id: "exec-9",
        status: "failed",
        attempt: 1,
        updatedAt: new Date("2026-09-08T10:00:00.000Z"),
        conversationId: "conv-9",
        projectId: null,
        conversation: { title: "任务" },
        _count: { toolExecutions: 3 },
      })
      .mockResolvedValueOnce({ _count: { toolExecutions: 0 } });

    const task = await sourceWith(client).getOwned({
      userId: "user-1",
      taskId: "exec-9",
    });

    expect(client.agentExecution.findFirst).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: { id: "exec-9", userId: "user-1" } })
    );
    expect(task).toMatchObject({
      status: "failed",
      canRetry: true,
      canCancel: false,
      completedUnits: 3,
    });
  });

  it("达到用户重试上限后不再提供重试", async () => {
    const client = fakeClient();
    client.agentExecution.findFirst
      .mockResolvedValueOnce({
        id: "exec-10",
        status: "cancelled",
        attempt: AGENT_EXECUTION_USER_RETRY_MAX_ATTEMPTS,
        updatedAt: new Date("2026-09-08T10:00:00.000Z"),
        conversationId: "conv-10",
        projectId: null,
        conversation: null,
        _count: { toolExecutions: 0 },
      })
      .mockResolvedValueOnce(null);

    const task = await sourceWith(client).getOwned({
      userId: "user-1",
      taskId: "exec-10",
    });

    expect(task).toMatchObject({ canRetry: false, title: "对话任务" });
  });

  it("非归属任务返回 null", async () => {
    const client = fakeClient();
    client.agentExecution.findFirst.mockResolvedValueOnce(null);

    expect(
      await sourceWith(client).getOwned({ userId: "user-1", taskId: "exec-x" })
    ).toBeNull();
  });
});
