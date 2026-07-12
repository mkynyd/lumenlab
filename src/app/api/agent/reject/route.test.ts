import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  recordAuditEvent: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({
  prisma: {
    toolExecution: {
      findUnique: mocks.findUnique,
      updateMany: mocks.updateMany,
    },
  },
}));
vi.mock("@/lib/agent/audit-log", () => ({
  recordAuditEvent: mocks.recordAuditEvent,
}));

import { POST } from "./route";

describe("POST /api/agent/reject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.findUnique.mockResolvedValue({
      id: "execution-1",
      userId: "user-1",
      conversationId: "conversation-1",
      skillId: null,
      toolId: "project_files.delete",
      status: "pending_approval",
    });
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.recordAuditEvent.mockResolvedValue(undefined);
  });

  it("claims the pending execution conditionally before recording rejection", async () => {
    const response = await POST(request({
      executionId: "execution-1",
      reason: "not now",
    }));

    expect(response.status).toBe(200);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        id: "execution-1",
        userId: "user-1",
        status: "pending_approval",
      },
      data: expect.objectContaining({
        status: "rejected",
        errorSummary: { code: "USER_REJECTED", message: "not now" },
      }),
    });
    expect(mocks.recordAuditEvent).toHaveBeenCalledTimes(1);
  });

  it("returns conflict when approval wins the concurrent state claim", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });

    const response = await POST(request({ executionId: "execution-1" }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "ToolExecution 已被其他请求处理",
    });
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
  });

  it("does not mutate an execution owned by another user", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "execution-1",
      userId: "user-2",
      status: "pending_approval",
    });

    const response = await POST(request({ executionId: "execution-1" }));

    expect(response.status).toBe(404);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});

function request(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/agent/reject", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
