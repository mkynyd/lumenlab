import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  projectFindFirst: vi.fn(),
  fileFindMany: vi.fn(),
  conversationFindFirst: vi.fn(),
  conversationCreate: vi.fn(),
  conversationUpdate: vi.fn(),
  conversationSkillCreate: vi.fn(),
  conversationSkillUpdateMany: vi.fn(),
  messageCreate: vi.fn(),
  messageFindMany: vi.fn(),
  messageUpdate: vi.fn(),
  messageDelete: vi.fn(),
  userFindUnique: vi.fn(),
  userUpdate: vi.fn(),
  tokenUsageCreate: vi.fn(),
  transaction: vi.fn(),
  getProviderApiKey: vi.fn(),
  retrieveProjectContext: vi.fn(),
  shouldUseProjectContext: vi.fn(),
  embedQuery: vi.fn(),
  streamChat: vi.fn(),
  completeChat: vi.fn(),
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
    conversationSkill: {
      create: mocks.conversationSkillCreate,
      updateMany: mocks.conversationSkillUpdateMany,
    },
    message: {
      create: mocks.messageCreate,
      findMany: mocks.messageFindMany,
      update: mocks.messageUpdate,
      delete: mocks.messageDelete,
    },
    user: { findUnique: mocks.userFindUnique, update: mocks.userUpdate },
    tokenUsage: { create: mocks.tokenUsageCreate },
    $transaction: mocks.transaction,
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
  streamChat: mocks.streamChat,
  completeChat: mocks.completeChat,
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
      sources: [],
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
    mocks.conversationSkillCreate.mockResolvedValue({});
    mocks.conversationSkillUpdateMany.mockResolvedValue({});
    mocks.messageCreate.mockResolvedValue({ id: "message-1" });
    mocks.messageFindMany.mockResolvedValue([]);
    mocks.messageUpdate.mockResolvedValue({});
    mocks.messageDelete.mockResolvedValue({});
    mocks.userFindUnique.mockResolvedValue({
      id: "user-1",
      cycleStartedAt: new Date("2026-07-01T00:00:00.000Z"),
      creditsUsed: 0,
      planCredits: 0,
    });
    mocks.userUpdate.mockResolvedValue({});
    mocks.tokenUsageCreate.mockResolvedValue({ id: "usage-1" });
    mocks.transaction.mockImplementation((ops: Array<Promise<unknown>>) =>
      Promise.all(ops)
    );
    mocks.conversationCreate.mockResolvedValue({
      id: "conversation-1",
      userId: "user-1",
      projectId: "project-1",
      model: "deepseek-v4-pro",
      modelLock: null,
      thinkingEnabled: false,
      activeSkillId: null,
      skillDisabled: false,
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

  it("serves ordinary chat through the Agent Orchestrator without project retrieval", async () => {
    const originalFlag = process.env.AGENT_ORCHESTRATOR_ENABLED;
    process.env.AGENT_ORCHESTRATOR_ENABLED = "1";
    mocks.getProviderApiKey.mockResolvedValue("sk-test");
    mocks.conversationCreate.mockResolvedValue({
      id: "conversation-1",
      userId: "user-1",
      projectId: "project-1",
      model: "deepseek-v4-pro",
      modelLock: null,
      thinkingEnabled: false,
      activeSkillId: null,
      skillDisabled: false,
    });
    mocks.messageCreate
      .mockResolvedValueOnce({ id: "user-message-1" })
      .mockResolvedValueOnce({ id: "assistant-message-1" });
    mocks.completeChat.mockResolvedValue({
      content: "你好",
      usage: null,
    });
    mocks.streamChat.mockResolvedValue({
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({ choices: [{ delta: { content: "你好" } }] })}\n\n`
            )
          );
          controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
          controller.close();
        },
      }),
      getUsage: () => ({ prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }),
      getToolCalls: () => [],
    });

    try {
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
      expect(response.status).toBe(200);
      expect(response.headers.get("X-Agent-Orchestrator")).toBe("enabled");
      expect(mocks.retrieveProjectContext).not.toHaveBeenCalled();

      const body = await response.text();
      expect(body).toContain("model_adapter_selected");
      expect(body).toContain("你好");
    } finally {
      if (originalFlag === undefined) {
        delete process.env.AGENT_ORCHESTRATOR_ENABLED;
      } else {
        process.env.AGENT_ORCHESTRATOR_ENABLED = originalFlag;
      }
    }
  });
});

describe("accumulateAndSave", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.messageUpdate.mockResolvedValue({});
    mocks.userFindUnique.mockResolvedValue({
      id: "user-1",
      cycleStartedAt: new Date("2026-07-01T00:00:00.000Z"),
      creditsUsed: 0,
      planCredits: 0,
    });
    mocks.userUpdate.mockResolvedValue({});
    mocks.tokenUsageCreate.mockResolvedValue({ id: "usage-1" });
    mocks.transaction.mockImplementation((ops: Array<Promise<unknown>>) =>
      Promise.all(ops)
    );
  });

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
      "user-1",
      "minimax-m3",
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

  it("classifies unreported input tokens as cache misses before persistence", async () => {
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
      "user-1",
      "deepseek-v4-pro",
      "deepseek",
      () => ({
        prompt_tokens: 1377,
        completion_tokens: 1143,
        total_tokens: 2520,
        prompt_cache_hit_tokens: 1024,
        prompt_cache_miss_tokens: 0,
      })
    );

    expect(mocks.messageUpdate).toHaveBeenCalledWith({
      where: { id: "message-1" },
      data: expect.objectContaining({
        tokenCount: 2520,
        cacheHitTokens: 1024,
        cacheMissTokens: 353,
      }),
    });
    expect(mocks.tokenUsageCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        totalTokens: 2520,
        inputCacheHitTokens: 1024,
        inputCacheMissTokens: 353,
        outputTokens: 1143,
      }),
    });
  });
});
