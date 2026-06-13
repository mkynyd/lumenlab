import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  projectFindFirst: vi.fn(),
  fileFindMany: vi.fn(),
  conversationFindFirst: vi.fn(),
  conversationCreate: vi.fn(),
  apiKeyFindUnique: vi.fn(),
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
    apiKey: { findUnique: mocks.apiKeyFindUnique },
  },
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
    mocks.apiKeyFindUnique.mockResolvedValue(null);
    mocks.conversationCreate.mockResolvedValue({
      id: "conversation-1",
      userId: "user-1",
      projectId: "project-1",
    });
  });

  it("does not create an empty conversation when the API key is missing", async () => {
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

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "尚未配置 API Key，请在设置中添加",
    });
    expect(mocks.conversationCreate).not.toHaveBeenCalled();
  });
});
