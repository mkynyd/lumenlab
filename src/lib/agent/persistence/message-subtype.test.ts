import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  messageFindMany: vi.fn(),
  messageUpdateMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    message: {
      findMany: mocks.messageFindMany,
      updateMany: mocks.messageUpdateMany,
    },
  },
}));

import { PrismaConversationAdapter } from "@/lib/agent/persistence/prisma-conversation-adapter";
import { excludingSubtype } from "@/lib/agent/persistence/message-subtype";

describe("excludingSubtype", () => {
  it("keeps NULL subtype rows inside the condition", () => {
    // Prisma 的 `not` 不匹配 NULL；普通消息的 subtype 为空，必须显式包含，
    // 否则历史上下文、压缩候选和替换标记都会整体失效。
    expect(excludingSubtype("compressed-replaced")).toEqual({
      OR: [
        { subtype: null },
        { subtype: { not: "compressed-replaced" } },
      ],
    });
  });
});

describe("PrismaConversationAdapter.loadHistory", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads ordinary (NULL subtype) messages and their bound image attachments", async () => {
    mocks.messageFindMany.mockResolvedValue([]);
    const adapter = new PrismaConversationAdapter();

    await adapter.loadHistory("conversation-1", ["message-x"]);

    expect(mocks.messageFindMany).toHaveBeenCalledWith({
      where: {
        conversationId: "conversation-1",
        OR: [{ subtype: null }, { subtype: { not: "compressed-replaced" } }],
        id: { notIn: ["message-x"] },
      },
      orderBy: { createdAt: "asc" },
      select: expect.objectContaining({
        id: true,
        role: true,
        content: true,
        attachments: expect.objectContaining({
          where: { status: "bound", mimeType: { startsWith: "image/" } },
        }),
      }),
    });
  });
});

describe("PrismaConversationAdapter.markMessagesCompressed", () => {
  beforeEach(() => vi.clearAllMocks());

  it("can still mark ordinary messages as replaced", async () => {
    mocks.messageUpdateMany.mockResolvedValue({ count: 2 });
    const adapter = new PrismaConversationAdapter();

    await adapter.markMessagesCompressed({
      conversationId: "conversation-1",
      messageIds: ["message-1", "message-2"],
      replacedBySummaryId: "summary-1",
    });

    expect(mocks.messageUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ subtype: null }, { subtype: { not: "context-summary" } }],
        }),
      })
    );
  });
});
