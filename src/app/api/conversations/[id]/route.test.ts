// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findFirst: vi.fn(),
  updateMany: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({
  prisma: {
    conversation: {
      findFirst: mocks.findFirst,
      updateMany: mocks.updateMany,
      delete: mocks.delete,
    },
  },
}));
vi.mock("@/lib/data/conversations", () => ({
  chatMessageSelect: () => ({ id: true }),
  toChatMessage: (message: unknown) => message,
}));
vi.mock("@/lib/chat/message-attachments", () => ({
  deleteConversationAttachmentObjects: vi.fn(),
}));

import { PATCH } from "@/app/api/conversations/[id]/route";

const context = { params: Promise.resolve({ id: "conversation-1" }) };

function patchRequest(body: unknown) {
  return new Request("http://localhost/api/conversations/1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH conversation rename", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.updateMany.mockResolvedValue({ count: 1 });
  });

  it("trims and stores a manual title", async () => {
    const response = await PATCH(patchRequest({ title: "  牛顿   迭代法  " }), context);
    const body = await response.json();

    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "conversation-1", userId: "user-1" },
      data: { title: "牛顿 迭代法" },
    });
    expect(body).toMatchObject({ title: "牛顿 迭代法" });
  });

  it("rejects an empty title", async () => {
    const response = await PATCH(patchRequest({ title: "   " }), context);

    expect(response.status).toBe(400);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("returns 404 when the conversation is not owned", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    const response = await PATCH(patchRequest({ title: "新标题" }), context);

    expect(response.status).toBe(404);
  });
});
