import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  conversationFindUnique: vi.fn(),
  messageFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    conversation: { findUnique: mocks.conversationFindUnique },
    message: { findMany: mocks.messageFindMany },
  },
}));
vi.mock("@/lib/agent/tool-registry", () => ({
  toolRegistry: { list: vi.fn(() => []), get: vi.fn() },
}));
vi.mock("@/lib/tools/registry", () => ({}));

import { listAdminMessages } from "./admin-observability-service";

describe("admin observability message projection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.conversationFindUnique.mockResolvedValue({
      id: "conversation-1",
      title: "测试对话",
      project: null,
    });
    mocks.messageFindMany.mockResolvedValue([
      {
        id: "message-1",
        role: "assistant",
        content: "最终回复",
        createdAt: new Date("2026-08-13T12:00:00.000Z"),
      },
    ]);
  });

  it("queries only user and assistant messages and excludes private fields", async () => {
    const params = new URLSearchParams({
      conversationId: "conversation-1",
      limit: "30",
    });

    const result = await listAdminMessages(params);

    expect(mocks.messageFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          conversationId: "conversation-1",
          role: { in: ["user", "assistant"] },
        }),
        select: {
          id: true,
          role: true,
          content: true,
          createdAt: true,
        },
        take: 31,
      })
    );
    expect(result?.items[0]).toEqual({
      id: "message-1",
      role: "assistant",
      content: "最终回复",
      createdAt: new Date("2026-08-13T12:00:00.000Z"),
    });
    expect(result?.conversation).not.toHaveProperty("userId");
  });
});
