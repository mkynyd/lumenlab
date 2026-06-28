import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  projectFindFirst: vi.fn(),
  fileFindMany: vi.fn(),
  conversationFindFirst: vi.fn(),
  conversationCreate: vi.fn(),
  conversationUpdate: vi.fn(),
  messageUpdate: vi.fn(),
  messageDelete: vi.fn(),
  getProviderApiKey: vi.fn(),
  retrieveProjectContext: vi.fn(),
  shouldUseProjectContext: vi.fn(),
  embedQuery: vi.fn(),
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
      update: mocks.conversationUpdate,
    },
    message: {
      update: mocks.messageUpdate,
      delete: mocks.messageDelete,
    },
  },
}));

vi.mock("@/lib/data/provider-access", () => ({
  getProviderApiKey: mocks.getProviderApiKey,
}));

vi.mock("@/lib/rag/vector-store", () => ({
  retrieveProjectContext: mocks.retrieveProjectContext,
  shouldUseProjectContext: mocks.shouldUseProjectContext,
}));

vi.mock("@/lib/rag/embedding", () => ({
  embedQuery: mocks.embedQuery,
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

import { accumulateAndSave, POST } from "@/app/api/chat/route";

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
    mocks.retrieveProjectContext.mockResolvedValue({
      context: "",
      notice: "未找到可用于回答的项目资料。",
      usedFileIds: [],
      truncated: false,
      debug: {
        strategy: "keyword_search",
        path: "keyword_search",
        scopeSource: "project",
        candidateFileCount: 0,
        matchedChunkCount: 0,
        generatedQueryEmbedding: false,
        fullDocumentChars: 0,
        finalContextChars: 0,
        truncated: false,
      },
    });
    mocks.shouldUseProjectContext.mockImplementation((query: string) =>
      query.includes("报告")
    );
    mocks.embedQuery.mockResolvedValue(Array.from({ length: 1024 }, (_, i) => i / 1024));
    mocks.conversationUpdate.mockResolvedValue({});
    mocks.messageUpdate.mockResolvedValue({});
    mocks.messageDelete.mockResolvedValue({});
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

  it("does not retrieve project context or embed query for ordinary project chat", async () => {
    const request = new NextRequest("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "你好，帮我解释一下动态规划是什么",
        model: "deepseek-v4-pro",
        thinkingEnabled: false,
        reasoningEffort: "high",
        projectId: "project-1",
        selectedFileIds: [],
        mode: "general",
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(403);
    expect(mocks.retrieveProjectContext).not.toHaveBeenCalled();
    expect(mocks.embedQuery).not.toHaveBeenCalled();
    expect(mocks.conversationCreate).not.toHaveBeenCalled();
  });
});

describe("accumulateAndSave", () => {
  it("persists the provider that actually produced the response", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            `data: ${JSON.stringify({ choices: [{ delta: { content: "完成" } }] })}\n\n`
          )
        );
        controller.close();
      },
    });

    await accumulateAndSave(
      stream,
      "conversation-1",
      "message-1",
      "minimax",
      () => ({
        prompt_tokens: 10,
        completion_tokens: 2,
        total_tokens: 12,
      })
    );

    expect(mocks.messageUpdate).toHaveBeenCalledWith({
      where: { id: "message-1" },
      data: expect.objectContaining({
        content: "完成",
        provider: "minimax",
        tokenCount: 12,
      }),
    });
  });
});
