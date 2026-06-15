import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  projectFindFirst: vi.fn(),
  fileFindMany: vi.fn(),
  conversationFindFirst: vi.fn(),
  conversationCreate: vi.fn(),
  getProviderApiKey: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: mocks.auth,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    project: { findFirst: mocks.projectFindFirst },
    fileAsset: { findMany: mocks.fileFindMany },
    conversation: {
      findFirst: mocks.conversationFindFirst,
      create: mocks.conversationCreate,
    },
  },
}));

vi.mock("@/lib/data/provider-access", () => ({
  getProviderApiKey: mocks.getProviderApiKey,
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: () => ({ allowed: true }),
  RateLimits: {
    CHAT: { max: 10, window: 60_000 },
  },
}));

vi.mock("@/lib/deepseek", () => ({
  DeepSeekError: class DeepSeekError extends Error {},
  streamChat: vi.fn(),
}));

import { POST } from "@/app/api/chat/route";

describe("POST /api/chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.projectFindFirst.mockResolvedValue({
      id: "project-1",
      userId: "user-1",
      name: "实验项目",
      type: "experiment",
      description: null,
    });
    mocks.fileFindMany.mockResolvedValue([]);
    mocks.getProviderApiKey.mockRejectedValue(
      new Error("当前账户没有可用的 Alpha 访问配置")
    );
    mocks.conversationCreate.mockResolvedValue({
      id: "conversation-1",
      userId: "user-1",
      projectId: "project-1",
    });
  });

  it("does not create an empty conversation when Alpha access is unavailable", async () => {
    const request = new NextRequest("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "生成实验报告",
        model: "deepseek-v4-pro",
        thinkingEnabled: false,
        reasoningEffort: "high",
        projectId: "project-1",
        selectedFileIds: [],
        mode: "experiment",
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "服务密钥暂时不可用",
    });
    expect(mocks.conversationCreate).not.toHaveBeenCalled();
  });
});
