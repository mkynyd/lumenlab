import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  userFindUnique: vi.fn(),
  projectCreate: vi.fn(),
  projectFindUniqueOrThrow: vi.fn(),
  quickActionCreateMany: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: mocks.auth,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: mocks.userFindUnique,
    },
    project: {
      create: mocks.projectCreate,
      findUniqueOrThrow: mocks.projectFindUniqueOrThrow,
    },
    quickAction: {
      createMany: mocks.quickActionCreateMany,
    },
    $transaction: mocks.transaction,
  },
}));

import { POST } from "@/app/api/projects/route";
import { getDefaultQuickActions } from "@/lib/quick-actions";

function post(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

const defaultQuickActionCount = getDefaultQuickActions("review").length;

describe("POST /api/projects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.userFindUnique.mockResolvedValue({ id: "user-1" });
    mocks.projectCreate.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({
        id: "project-1",
        ...data,
        createdAt: new Date("2026-07-31T08:00:00.000Z"),
        updatedAt: new Date("2026-07-31T08:00:00.000Z"),
      })
    );
    mocks.quickActionCreateMany.mockResolvedValue({ count: 2 });
    mocks.transaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          project: { create: mocks.projectCreate },
          quickAction: { createMany: mocks.quickActionCreateMany },
        })
    );
    mocks.projectFindUniqueOrThrow.mockResolvedValue({
      id: "project-1",
      userId: "user-1",
      name: "电路实验",
      description: null,
      type: "review",
      defaultModel: "deepseek-v4-flash",
      thinkingEnabled: true,
      createdAt: "2026-07-31T08:00:00.000Z",
      updatedAt: "2026-07-31T08:00:00.000Z",
      files: [],
      conversations: [],
      quickActions: [
        {
          id: "qa-default",
          title: "整理资料",
          prompt: "请整理",
          isSystem: true,
          sortOrder: 0,
        },
        {
          id: "qa-user",
          title: "讲解",
          prompt: "请讲解这个知识点",
          isSystem: false,
          sortOrder: 100,
        },
      ],
      _count: { conversations: 0, files: 0 },
    });
  });

  it("creates the project without nested quickActions or include, then writes quick actions serially", async () => {
    const response = await post({
      name: "电路实验",
      type: "review",
      quickActions: [{ title: "讲解", prompt: "请讲解这个知识点" }],
    });

    expect(response.status).toBe(201);

    // 项目创建不携带嵌套 quickActions 与 include，避免查询编译器并发派发。
    expect(mocks.projectCreate).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        name: "电路实验",
        description: null,
        type: "review",
        defaultModel: "deepseek-v4-flash",
        thinkingEnabled: true,
      },
    });
    const createCall = mocks.projectCreate.mock.calls[0][0];
    expect(createCall.data).not.toHaveProperty("quickActions");
    expect(createCall).not.toHaveProperty("include");

    // 默认与用户快捷指令在项目创建后统一批量写入。
    expect(mocks.quickActionCreateMany).toHaveBeenCalledTimes(1);
    const createManyCall = mocks.quickActionCreateMany.mock.calls[0][0];
    expect(createManyCall.data).toHaveLength(defaultQuickActionCount + 1);
    for (const action of createManyCall.data) {
      expect(action.projectId).toBe("project-1");
    }
    expect(createManyCall.data[defaultQuickActionCount]).toEqual({
      projectId: "project-1",
      title: "讲解",
      prompt: "请讲解这个知识点",
      isSystem: false,
      sortOrder: 100,
    });

    // 串行：项目先建，快捷指令后写。
    expect(mocks.projectCreate.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.quickActionCreateMany.mock.invocationCallOrder[0]
    );

    // 读回组装，响应 shape 与前端 ProjectDetail 期望一致。
    expect(mocks.projectFindUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: "project-1" },
      include: {
        files: true,
        conversations: true,
        quickActions: {
          orderBy: [{ isSystem: "desc" }, { sortOrder: "asc" }],
        },
        _count: {
          select: { conversations: true, files: true },
        },
      },
    });

    const body = await response.json();
    expect(body).toMatchObject({
      project: {
        id: "project-1",
        name: "电路实验",
        files: [],
        conversations: [],
        quickActions: [
          { id: "qa-default", isSystem: true, sortOrder: 0 },
          { id: "qa-user", isSystem: false, sortOrder: 100 },
        ],
        _count: { conversations: 0, files: 0 },
      },
    });
  });

  it("writes quick actions with mapped defaults when no custom actions are given", async () => {
    const response = await post({ name: "电路实验", type: "review" });

    expect(response.status).toBe(201);
    expect(mocks.quickActionCreateMany).toHaveBeenCalledTimes(1);
    const createManyCall = mocks.quickActionCreateMany.mock.calls[0][0];
    expect(createManyCall.data).toHaveLength(defaultQuickActionCount);
    for (const action of createManyCall.data) {
      expect(action.isSystem).toBe(true);
      expect(action.projectId).toBe("project-1");
    }
  });

  it("rejects unauthenticated requests", async () => {
    mocks.auth.mockResolvedValue(null);
    const response = await post({ name: "电路实验", type: "review" });
    expect(response.status).toBe(401);
    expect(mocks.projectCreate).not.toHaveBeenCalled();
  });

  it("rejects when the session user no longer exists", async () => {
    mocks.userFindUnique.mockResolvedValue(null);
    const response = await post({ name: "电路实验", type: "review" });
    expect(response.status).toBe(401);
    expect(mocks.projectCreate).not.toHaveBeenCalled();
  });

  it("rejects invalid payloads", async () => {
    const response = await post({ name: "", type: "review" });
    expect(response.status).toBe(400);
    expect(mocks.projectCreate).not.toHaveBeenCalled();
  });
});
