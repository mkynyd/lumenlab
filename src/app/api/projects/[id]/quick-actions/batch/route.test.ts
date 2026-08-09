import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  projectFindFirst: vi.fn(),
  quickActionAggregate: vi.fn(),
  quickActionCreateMany: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: mocks.auth,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    project: {
      findFirst: mocks.projectFindFirst,
    },
    quickAction: {
      aggregate: mocks.quickActionAggregate,
      createMany: mocks.quickActionCreateMany,
    },
  },
}));

import { POST } from "@/app/api/projects/[id]/quick-actions/batch/route";

function post(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/projects/project-1/quick-actions/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "project-1" }) }
  );
}

describe("POST /api/projects/[id]/quick-actions/batch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.projectFindFirst.mockResolvedValue({ id: "project-1" });
    mocks.quickActionAggregate.mockResolvedValue({ _max: { sortOrder: 2 } });
    mocks.quickActionCreateMany.mockResolvedValue({ count: 1 });
  });

  it("accepts titles up to 20 characters", async () => {
    const response = await post({
      actions: [{ title: "整理这份资料的章节结构", prompt: "请整理" }],
    });

    expect(response.status).toBe(201);
    expect(mocks.quickActionCreateMany).toHaveBeenCalledTimes(1);
    expect(mocks.quickActionCreateMany.mock.calls[0][0].data[0]).toMatchObject({
      projectId: "project-1",
      title: "整理这份资料的章节结构",
      isSystem: false,
    });
  });

  it("rejects titles longer than 20 characters", async () => {
    const response = await post({
      actions: [{ title: "这个快捷任务标题实在是太长太长太长太长太长了", prompt: "请整理" }],
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(typeof body.error).toBe("object");
    expect(mocks.quickActionCreateMany).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated requests", async () => {
    mocks.auth.mockResolvedValue(null);
    const response = await post({
      actions: [{ title: "讲解", prompt: "请讲解" }],
    });
    expect(response.status).toBe(401);
  });
});
