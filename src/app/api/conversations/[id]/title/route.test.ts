// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findFirst: vi.fn(),
  updateMany: vi.fn(),
  getProviderApiKey: vi.fn(),
  createTextMessage: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({
  prisma: { conversation: { findFirst: mocks.findFirst, updateMany: mocks.updateMany } },
}));
vi.mock("@/lib/data/provider-access", () => ({
  getProviderApiKey: mocks.getProviderApiKey,
}));
vi.mock("@/lib/deepseek", () => ({ createTextMessage: mocks.createTextMessage }));

import { POST } from "@/app/api/conversations/[id]/title/route";

const context = { params: Promise.resolve({ id: "conversation-1" }) };

function conversation(title: string, userContent = "请整理牛顿迭代法作业") {
  return {
    id: "conversation-1",
    title,
    messages: [
      { role: "user", content: userContent, attachments: [] },
      { role: "assistant", content: "牛顿迭代法是一种求方程近似根的方法。", attachments: [] },
    ],
  };
}

describe("POST conversation title", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.getProviderApiKey.mockResolvedValue("key");
    mocks.updateMany.mockResolvedValue({ count: 1 });
  });

  it("never writes refusal-like model output; keeps the deterministic bootstrap title", async () => {
    mocks.findFirst.mockResolvedValue(conversation("信息不足，无法概括"));
    mocks.createTextMessage.mockResolvedValue("无法生成标题：首条消息内容不足");

    const response = await POST(new Request("http://localhost/api/conversations/1/title"), context);
    const body = await response.json();

    expect(mocks.createTextMessage).toHaveBeenCalledTimes(2);
    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { title: "请整理牛顿迭代法作业" },
      })
    );
    expect(body).toMatchObject({
      title: "请整理牛顿迭代法作业",
      generated: false,
    });
  });

  it("writes a valid generated title after the first answer", async () => {
    mocks.findFirst.mockResolvedValue(conversation("请整理牛顿迭代法作业"));
    mocks.createTextMessage.mockResolvedValue("牛顿迭代法作业整理");

    const response = await POST(new Request("http://localhost/api/conversations/1/title"), context);
    const body = await response.json();

    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { title: "牛顿迭代法作业整理" },
      })
    );
    expect(body).toMatchObject({ title: "牛顿迭代法作业整理", generated: true });
  });

  it("never overwrites a manual title", async () => {
    mocks.findFirst.mockResolvedValue(conversation("考研数学复习"));

    const response = await POST(new Request("http://localhost/api/conversations/1/title"), context);
    const body = await response.json();

    expect(mocks.createTextMessage).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(body).toMatchObject({ title: "考研数学复习", generated: false });
  });
});
