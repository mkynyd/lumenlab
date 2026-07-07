import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  projectFindFirst: vi.fn(),
  projectFindUnique: vi.fn(),
  fileFindFirst: vi.fn(),
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
  toolExecutionCreate: vi.fn(),
  toolExecutionUpdate: vi.fn(),
  agentAuditLogCreate: vi.fn(),
  transaction: vi.fn(),
  getProviderApiKey: vi.fn(),
  retrieveProjectContext: vi.fn(),
  shouldUseProjectContext: vi.fn(),
  embedQuery: vi.fn(),
  streamChat: vi.fn(),
  streamMiniMaxChat: vi.fn(),
  completeChat: vi.fn(),
  runWebSearch: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: mocks.auth,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    project: { findFirst: mocks.projectFindFirst, findUnique: mocks.projectFindUnique },
    fileAsset: { findFirst: mocks.fileFindFirst, findMany: mocks.fileFindMany },
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
    toolExecution: {
      create: mocks.toolExecutionCreate,
      update: mocks.toolExecutionUpdate,
    },
    agentAuditLog: { create: mocks.agentAuditLogCreate },
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

vi.mock("@/lib/chat/minimax-chat", () => ({
  MiniMaxChatError: class MiniMaxChatError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  },
  streamMiniMaxChat: mocks.streamMiniMaxChat,
}));

vi.mock("@/lib/tools/web/search-engine", () => ({
  runWebSearch: mocks.runWebSearch,
}));

import { accumulateAndSave, POST } from "@/app/api/chat/route";
import { _internalForTesting as agentLoopInternal } from "@/lib/agent/conversation-loop";

describe("POST /api/chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.streamChat.mockReset();
    mocks.streamMiniMaxChat.mockReset();
    mocks.completeChat.mockReset();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.projectFindFirst.mockResolvedValue({
      id: "project-1",
      userId: "user-1",
      name: "实验项目",
      type: "experiment",
      description: null,
    });
    mocks.projectFindUnique.mockResolvedValue({
      id: "project-1",
      userId: "user-1",
      name: "实验项目",
      type: "experiment",
      description: null,
    });
    mocks.fileFindFirst.mockResolvedValue(null);
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
    mocks.toolExecutionCreate.mockResolvedValue({ id: "tool-execution-1" });
    mocks.toolExecutionUpdate.mockResolvedValue({});
    mocks.agentAuditLogCreate.mockResolvedValue({ id: "audit-1" });
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
    mocks.streamMiniMaxChat.mockResolvedValue({
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({ choices: [{ delta: { content: "MiniMax 回复" } }] })}\n\n`
            )
          );
          controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
          controller.close();
        },
      }),
      getUsage: () => ({
        prompt_tokens: 1,
        completion_tokens: 1,
        total_tokens: 2,
      }),
      getToolCalls: () => [],
      getRawContent: () => "MiniMax 回复",
      getRawReasoning: () => "",
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
    mocks.streamChat.mockResolvedValue(
      makeStreamResult({ deltas: [{ content: "你好" }] })
    );

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

  it("prefetches the full project corpus for quick tasks even when no files are selected", async () => {
    const originalFlag = process.env.AGENT_ORCHESTRATOR_ENABLED;
    process.env.AGENT_ORCHESTRATOR_ENABLED = "1";
    mocks.getProviderApiKey.mockResolvedValue("sk-test");
    mocks.fileFindMany.mockResolvedValueOnce([
      {
        id: "file-1",
        originalName: "网络安全实习指导书.md",
        category: "讲义",
        categoryConfidence: 1,
        status: "parsed",
        textContent: "实验一 使用 Nmap 进行端口扫描并记录开放端口。",
        enhancedContent: null,
        processingMetadata: {
          summary: "Nmap 端口扫描实验",
          keywords: ["Nmap", "端口扫描"],
        },
      },
    ]);
    mocks.conversationCreate.mockResolvedValue({
      id: "conversation-1",
      userId: "user-1",
      projectId: "project-1",
      model: "deepseek-v4-pro",
      modelLock: null,
      thinkingEnabled: true,
      activeSkillId: "code-reader",
      skillDisabled: false,
    });
    mocks.messageCreate
      .mockResolvedValueOnce({ id: "user-message-1" })
      .mockResolvedValueOnce({ id: "assistant-message-1" });
    mocks.streamChat.mockResolvedValue(
      makeStreamResult({ deltas: [{ content: "已生成逻辑图" }] })
    );

    try {
      const request = new NextRequest("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "快捷任务：生成 Mermaid 逻辑图",
          hiddenPrompt: "请基于项目资料生成 Mermaid flowchart LR",
          model: "deepseek-v4-pro",
          thinkingEnabled: true,
          reasoningEffort: "max",
          projectId: "project-1",
          selectedFileIds: [],
          mode: "review",
          isQuickTask: true,
          materialScope: "project-corpus",
        }),
      });

      const response = await POST(request);
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(body).toContain("sources_updated");
      expect(mocks.retrieveProjectContext).not.toHaveBeenCalled();
      expect(mocks.streamChat).toHaveBeenCalledTimes(1);

      const firstCall = mocks.streamChat.mock.calls[0];
      const streamRequest = firstCall[1] as {
        messages: Array<{ role: string; content: string }>;
        tools?: Array<{ function?: { name?: string }; name?: string }>;
      };
      const userMessage = streamRequest.messages.find((m) => m.role === "user");
      expect(userMessage?.content).toContain("项目资料预取结果");
      expect(userMessage?.content).toContain("当前项目内全部 1 份可读资料");
      expect(userMessage?.content).toContain("实验一 使用 Nmap");
      const toolNames = (streamRequest.tools ?? []).map(
        (tool) => tool.function?.name ?? tool.name
      );
      expect(toolNames).not.toContain("project_rag.search");
      expect(toolNames).not.toContain("project_files.read");
    } finally {
      if (originalFlag === undefined) {
        delete process.env.AGENT_ORCHESTRATOR_ENABLED;
      } else {
        process.env.AGENT_ORCHESTRATOR_ENABLED = originalFlag;
      }
    }
  });

  it("prefetches web search context for MiniMax manual web search", async () => {
    const originalFlag = process.env.AGENT_ORCHESTRATOR_ENABLED;
    process.env.AGENT_ORCHESTRATOR_ENABLED = "0";
    mocks.getProviderApiKey.mockResolvedValue("sk-test");
    mocks.projectFindFirst.mockResolvedValue(null);
    mocks.conversationCreate.mockResolvedValue({
      id: "conversation-1",
      userId: "user-1",
      projectId: null,
      model: "minimax-m3",
      modelLock: null,
      thinkingEnabled: true,
      activeSkillId: null,
      skillDisabled: false,
    });
    mocks.runWebSearch.mockResolvedValue({
      query: "今天有什么 AI 新闻",
      summary: "联网摘要：AI 新闻更新。",
      sources: [{ title: "AI News", url: "https://example.com/ai" }],
    });
    mocks.messageCreate
      .mockResolvedValueOnce({ id: "user-message-1" })
      .mockResolvedValueOnce({ id: "assistant-message-1" });

    try {
      const request = new NextRequest("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "今天有什么 AI 新闻",
          model: "minimax-m3",
          thinkingEnabled: true,
          reasoningEffort: "max",
          webSearchActive: true,
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
      expect(mocks.runWebSearch).toHaveBeenCalledWith(
        "今天有什么 AI 新闻",
        "sk-test"
      );
      expect(mocks.streamMiniMaxChat).toHaveBeenCalledWith(
        "sk-test",
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: "user",
              content: expect.stringContaining("# 联网搜索结果"),
            }),
          ]),
        })
      );

      const body = await response.text();
      expect(body).toContain("web_access_enabled");
      expect(body).toContain("sources_updated");
      expect(body).toContain("MiniMax 回复");
    } finally {
      if (originalFlag === undefined) {
        delete process.env.AGENT_ORCHESTRATOR_ENABLED;
      } else {
        process.env.AGENT_ORCHESTRATOR_ENABLED = originalFlag;
      }
    }
  });

  it("executes delayed XML tool calls before streaming the final DeepSeek answer", async () => {
    const originalFlag = process.env.AGENT_ORCHESTRATOR_ENABLED;
    process.env.AGENT_ORCHESTRATOR_ENABLED = "0";
    mocks.getProviderApiKey.mockResolvedValue("sk-test");
    mocks.projectFindFirst.mockResolvedValue({
      id: "project-1",
      userId: "user-1",
      name: "实验项目",
      type: "academic",
      description: null,
    });
    mocks.fileFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "file-1",
          originalName: "等级保护资料.md",
          mimeType: "text/markdown",
          size: 2048,
          status: "ready",
          category: "document",
          createdAt: new Date("2026-07-07T00:00:00.000Z"),
        },
      ]);
    mocks.conversationCreate.mockResolvedValue({
      id: "conversation-1",
      userId: "user-1",
      projectId: "project-1",
      model: "deepseek-v4-pro",
      modelLock: null,
      thinkingEnabled: true,
      activeSkillId: null,
      skillDisabled: false,
    });
    mocks.messageCreate
      .mockResolvedValueOnce({ id: "user-message-1" })
      .mockResolvedValueOnce({ id: "assistant-message-1" });

    mocks.streamChat
      .mockResolvedValueOnce(
        makeStreamResult({
          deltas: [
            {
              content:
                "我先检查项目资料。\n<tool_calls><invoke name=\"project_files.list\"><parameter name=\"projectId\">project-1</parameter></invoke></tool_calls>",
            },
          ],
          rawContent:
            "我先检查项目资料。\n<tool_calls><invoke name=\"project_files.list\"><parameter name=\"projectId\">project-1</parameter></invoke></tool_calls>",
          toolCalls: [
            {
              id: "xml-project-files-list-1",
              name: "project_files.list",
              input: { projectId: "project-1" },
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        makeStreamResult({
          deltas: [{ content: "最终论文提纲" }],
        })
      );

    try {
      const request = new NextRequest("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "基于项目资料写一篇关于等级保护的论文提纲",
          model: "deepseek-v4-pro",
          thinkingEnabled: true,
          reasoningEffort: "max",
          projectId: "project-1",
          selectedFileIds: [],
          mode: "review",
        }),
      });

      const response = await POST(request);
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(mocks.streamChat).toHaveBeenCalledTimes(2);
      expect(mocks.toolExecutionCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            toolId: "project_files.list",
            status: "proposed",
          }),
        })
      );
      expect(body).toContain("最终论文提纲");
      expect(body).not.toContain("<tool_calls>");
      expect(body).not.toContain("invoke name");
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

function makeSSEStream(
  deltas: Array<{ content?: string; reasoning_content?: string }>,
  extras?: { usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } }
) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const delta of deltas) {
        controller.enqueue(
          new TextEncoder().encode(
            `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`
          )
        );
      }
      if (extras?.usage) {
        controller.enqueue(
          new TextEncoder().encode(
            `data: ${JSON.stringify({ usage: extras.usage })}\n\n`
          )
        );
      }
      controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function makeStreamResult(options: {
  deltas: Array<{ content?: string; reasoning_content?: string }>;
  toolCalls?: { id: string; name: string; input: Record<string, unknown> }[];
  rawContent?: string;
  rawReasoning?: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}) {
  return {
    stream: makeSSEStream(options.deltas, { usage: options.usage }),
    getUsage: () =>
      options.usage ?? {
        prompt_tokens: 1,
        completion_tokens: 1,
        total_tokens: 2,
      },
    getToolCalls: () => options.toolCalls ?? [],
    getRawContent: () => options.rawContent ?? "",
    getRawReasoning: () => options.rawReasoning ?? "",
  };
}

describe("Streaming tool loop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.streamChat.mockReset();
    mocks.streamMiniMaxChat.mockReset();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.projectFindFirst.mockResolvedValue({
      id: "project-1",
      userId: "user-1",
      name: "实验项目",
      type: "academic",
      description: null,
    });
    mocks.projectFindUnique.mockResolvedValue({
      id: "project-1",
      userId: "user-1",
      name: "实验项目",
      type: "academic",
      description: null,
    });
    mocks.fileFindFirst.mockResolvedValue(null);
    mocks.fileFindMany.mockResolvedValue([]);
    mocks.conversationCreate.mockResolvedValue({
      id: "conversation-1",
      userId: "user-1",
      projectId: "project-1",
      model: "deepseek-v4-pro",
      modelLock: null,
      thinkingEnabled: true,
      activeSkillId: null,
      skillDisabled: false,
    });
    mocks.conversationFindFirst.mockResolvedValue({
      id: "conversation-1",
      userId: "user-1",
      projectId: "project-1",
      model: "deepseek-v4-pro",
      modelLock: null,
      thinkingEnabled: true,
      activeSkillId: null,
      skillDisabled: false,
    });
    mocks.messageFindMany.mockResolvedValue([]);
    mocks.messageCreate
      .mockResolvedValueOnce({ id: "user-message-1" })
      .mockResolvedValueOnce({ id: "assistant-message-1" });
    mocks.conversationUpdate.mockResolvedValue({});
    mocks.conversationSkillCreate.mockResolvedValue({});
    mocks.conversationSkillUpdateMany.mockResolvedValue({});
    mocks.messageUpdate.mockResolvedValue({});
    mocks.messageDelete.mockResolvedValue({});
    mocks.toolExecutionCreate.mockResolvedValue({ id: "tool-execution-1" });
    mocks.toolExecutionUpdate.mockResolvedValue({});
    mocks.agentAuditLogCreate.mockResolvedValue({ id: "audit-1" });
    mocks.getProviderApiKey.mockResolvedValue("sk-test");
    mocks.tokenUsageCreate.mockResolvedValue({ id: "usage-1" });
    mocks.userFindUnique.mockResolvedValue({
      id: "user-1",
      cycleStartedAt: new Date("2026-07-01T00:00:00.000Z"),
      creditsUsed: 0,
      planCredits: 0,
    });
    mocks.userUpdate.mockResolvedValue({});
    mocks.transaction.mockImplementation((ops: Array<Promise<unknown>>) =>
      Promise.all(ops)
    );
  });

  it("injects XML tool instructions into the system prompt before the first DeepSeek stream", async () => {
    const originalFlag = process.env.AGENT_ORCHESTRATOR_ENABLED;
    process.env.AGENT_ORCHESTRATOR_ENABLED = "0";

    mocks.streamChat.mockResolvedValueOnce(
      makeStreamResult({
        deltas: [{ content: "好的。" }],
      })
    );

    try {
      await POST(
        new NextRequest("http://localhost/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: "基于项目资料写论文提纲",
            model: "deepseek-v4-pro",
            thinkingEnabled: true,
            reasoningEffort: "max",
            projectId: "project-1",
            selectedFileIds: [],
            mode: "review",
          }),
        })
      );

      const firstCall = mocks.streamChat.mock.calls[0];
      const request = firstCall[1] as { messages: Array<{ role: string; content: string | unknown[] }> };
      const systemMessage = request.messages.find((m) => m.role === "system");
      expect(systemMessage).toBeDefined();
      const systemText = typeof systemMessage!.content === "string" ? systemMessage!.content : "";
      expect(systemText).toContain("<tool_calls>");
      expect(systemText).toContain("project_files.list");
      expect(systemText).toContain("严格使用如下 XML 格式");
    } finally {
      if (originalFlag === undefined) {
        delete process.env.AGENT_ORCHESTRATOR_ENABLED;
      } else {
        process.env.AGENT_ORCHESTRATOR_ENABLED = originalFlag;
      }
    }
  });

  it("executes native tool_use blocks and streams the final answer", async () => {
    const originalFlag = process.env.AGENT_ORCHESTRATOR_ENABLED;
    process.env.AGENT_ORCHESTRATOR_ENABLED = "0";

    mocks.streamChat
      .mockResolvedValueOnce(
        makeStreamResult({
          deltas: [{ content: "我先" }, { content: "查看资料。" }],
          toolCalls: [
            {
              id: "tu-1",
              name: "project_files.list",
              input: { projectId: "project-1" },
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        makeStreamResult({
          deltas: [{ content: "最终" }, { content: "论文提纲" }],
        })
      );

    try {
      const response = await POST(
        new NextRequest("http://localhost/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: "基于项目资料写论文提纲",
            model: "deepseek-v4-pro",
            thinkingEnabled: true,
            reasoningEffort: "max",
            projectId: "project-1",
            selectedFileIds: [],
            mode: "review",
          }),
        })
      );

      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toContain("最终");
      expect(body).toContain("论文提纲");
      expect(body).not.toContain("<tool_calls>");
      expect(mocks.streamChat).toHaveBeenCalledTimes(2);
      expect(mocks.toolExecutionCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            toolId: "project_files.list",
            status: "proposed",
          }),
        })
      );
      // Final answer should be delivered as multiple SSE data lines.
      expect(body.match(/data:/g)?.length).toBeGreaterThan(2);
    } finally {
      if (originalFlag === undefined) {
        delete process.env.AGENT_ORCHESTRATOR_ENABLED;
      } else {
        process.env.AGENT_ORCHESTRATOR_ENABLED = originalFlag;
      }
    }
  });

  it("executes DSML tool calls from raw reasoning", async () => {
    const originalFlag = process.env.AGENT_ORCHESTRATOR_ENABLED;
    process.env.AGENT_ORCHESTRATOR_ENABLED = "0";

    mocks.streamChat
      .mockResolvedValueOnce(
        makeStreamResult({
          deltas: [{ reasoning_content: "检索资料中。" }],
          rawReasoning:
            '检索资料中。<| | DSML | | invoke name="project_files.list"><| | DSML | | parameter name="projectId">project-1</| | DSML | | parameter></| | DSML | | invoke>',
        })
      )
      .mockResolvedValueOnce(
        makeStreamResult({
          deltas: [{ content: "资料列表为空，继续回答。" }],
        })
      );

    try {
      const response = await POST(
        new NextRequest("http://localhost/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: "列出项目资料",
            model: "deepseek-v4-pro",
            thinkingEnabled: true,
            reasoningEffort: "max",
            projectId: "project-1",
            selectedFileIds: [],
            mode: "review",
          }),
        })
      );

      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toContain("资料列表为空，继续回答。");
      expect(body).not.toContain("DSML");
      expect(mocks.streamChat).toHaveBeenCalledTimes(2);
      expect(mocks.toolExecutionCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            toolId: "project_files.list",
            status: "proposed",
          }),
        })
      );
    } finally {
      if (originalFlag === undefined) {
        delete process.env.AGENT_ORCHESTRATOR_ENABLED;
      } else {
        process.env.AGENT_ORCHESTRATOR_ENABLED = originalFlag;
      }
    }
  });

  it("sanitizes malformed nested tool_calls instead of executing them", async () => {
    const originalFlag = process.env.AGENT_ORCHESTRATOR_ENABLED;
    process.env.AGENT_ORCHESTRATOR_ENABLED = "0";

    const raw =
      '思考。<tool_calls> <tool_calls> list </tool_calls> 继续。';
    mocks.streamChat.mockResolvedValueOnce(
      makeStreamResult({
        // The stream from deepseek.ts is already sanitized; raw markup is only
        // exposed through getRawContent for route-level parsing.
        deltas: [{ content: "思考。 继续。" }],
        rawContent: raw,
      })
    );

    try {
      const response = await POST(
        new NextRequest("http://localhost/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: "基于项目资料写论文提纲",
            model: "deepseek-v4-pro",
            thinkingEnabled: true,
            reasoningEffort: "max",
            projectId: "project-1",
            selectedFileIds: [],
            mode: "review",
          }),
        })
      );

      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toContain("思考。");
      expect(body).toContain("继续。");
      expect(body).not.toContain("<tool_calls>");
      expect(body).not.toContain("list");
      expect(mocks.streamChat).toHaveBeenCalledTimes(1);
      expect(mocks.toolExecutionCreate).not.toHaveBeenCalled();
    } finally {
      if (originalFlag === undefined) {
        delete process.env.AGENT_ORCHESTRATOR_ENABLED;
      } else {
        process.env.AGENT_ORCHESTRATOR_ENABLED = originalFlag;
      }
    }
  });

  it("blocks hallucinated tool names and records an audit event", async () => {
    const originalFlag = process.env.AGENT_ORCHESTRATOR_ENABLED;
    process.env.AGENT_ORCHESTRATOR_ENABLED = "0";

    mocks.streamChat.mockResolvedValueOnce(
      makeStreamResult({
        deltas: [{ content: "我将调用 foo.bar。" }],
        toolCalls: [{ id: "tu-foo", name: "foo.bar", input: { x: 1 } }],
      })
    );

    try {
      const response = await POST(
        new NextRequest("http://localhost/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: "测试",
            model: "deepseek-v4-pro",
            thinkingEnabled: true,
            reasoningEffort: "max",
            projectId: "project-1",
            selectedFileIds: [],
            mode: "review",
          }),
        })
      );

      expect(response.status).toBe(200);
      expect(mocks.streamChat).toHaveBeenCalledTimes(1);
      await flushPromises();
      expect(mocks.agentAuditLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            eventType: "tool_blocked",
            toolId: "foo.bar",
          }),
        })
      );
      expect(mocks.toolExecutionCreate).not.toHaveBeenCalled();
    } finally {
      if (originalFlag === undefined) {
        delete process.env.AGENT_ORCHESTRATOR_ENABLED;
      } else {
        process.env.AGENT_ORCHESTRATOR_ENABLED = originalFlag;
      }
    }
  });

  it("stops at the 8-round tool limit and asks for a wrap-up answer", async () => {
    const originalFlag = process.env.AGENT_ORCHESTRATOR_ENABLED;
    process.env.AGENT_ORCHESTRATOR_ENABLED = "0";

    mocks.fileFindFirst.mockResolvedValue({
      id: "file-1",
      originalName: "示例.md",
      mimeType: "text/markdown",
      status: "ready",
      textContent: "示例内容",
      enhancedContent: "",
    });

    const chain = mocks.streamChat;
    for (let i = 0; i < 8; i++) {
      chain.mockResolvedValueOnce(
        makeStreamResult({
          deltas: [{ content: `第${i + 1}轮：读取文件。` }],
          toolCalls: [
            {
              id: `tu-read-${i}`,
              name: "project_files.read",
              input: { projectId: "project-1", fileId: `file-${i}` },
            },
          ],
        })
      );
    }
    chain.mockResolvedValueOnce(
      makeStreamResult({
        deltas: [{ content: "已输出总结" }],
      })
    );

    try {
      const response = await POST(
        new NextRequest("http://localhost/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: "详细分析资料",
            model: "deepseek-v4-pro",
            thinkingEnabled: true,
            reasoningEffort: "max",
            projectId: "project-1",
            selectedFileIds: [],
            mode: "review",
          }),
        })
      );

      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toContain("已输出总结");
      expect(mocks.streamChat).toHaveBeenCalledTimes(9);
      expect(mocks.toolExecutionCreate).toHaveBeenCalledTimes(8);

      const lastCall = mocks.streamChat.mock.calls[8];
      const lastRequest = lastCall[1] as { messages: Array<{ role: string; content: string | unknown }> };
      const messagesText = JSON.stringify(lastRequest.messages);
      expect(messagesText).toContain("已达到工具调用上限");
    } finally {
      if (originalFlag === undefined) {
        delete process.env.AGENT_ORCHESTRATOR_ENABLED;
      } else {
        process.env.AGENT_ORCHESTRATOR_ENABLED = originalFlag;
      }
    }
  });

  it("blocks duplicate tool calls with the same arguments", async () => {
    const originalFlag = process.env.AGENT_ORCHESTRATOR_ENABLED;
    process.env.AGENT_ORCHESTRATOR_ENABLED = "0";

    mocks.fileFindMany.mockResolvedValue([
      {
        id: "file-1",
        originalName: "示例.md",
        mimeType: "text/markdown",
        size: 2048,
        status: "ready",
        category: "document",
        createdAt: new Date("2026-07-07T00:00:00.000Z"),
      },
    ]);

    mocks.streamChat
      .mockResolvedValueOnce(
        makeStreamResult({
          deltas: [{ content: "第1轮：列出文件。" }],
          toolCalls: [
            {
              id: "tu-list",
              name: "project_files.list",
              input: { projectId: "project-1" },
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        makeStreamResult({
          deltas: [{ content: "最终回答" }],
          toolCalls: [
            {
              id: "tu-list-dup",
              name: "project_files.list",
              input: { projectId: "project-1" },
            },
          ],
        })
      );

    try {
      const response = await POST(
        new NextRequest("http://localhost/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: "列出项目资料",
            model: "deepseek-v4-pro",
            thinkingEnabled: true,
            reasoningEffort: "max",
            projectId: "project-1",
            selectedFileIds: [],
            mode: "review",
          }),
        })
      );

      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toContain("最终回答");
      expect(body).toContain("tool_blocked");
      expect(mocks.streamChat).toHaveBeenCalledTimes(2);
      expect(mocks.toolExecutionCreate).toHaveBeenCalledTimes(1);

      await flushPromises();
      expect(mocks.agentAuditLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            eventType: "tool_blocked",
            toolId: "project_files.list",
            payload: expect.objectContaining({ reason: "duplicate_call" }),
          }),
        })
      );
    } finally {
      if (originalFlag === undefined) {
        delete process.env.AGENT_ORCHESTRATOR_ENABLED;
      } else {
        process.env.AGENT_ORCHESTRATOR_ENABLED = originalFlag;
      }
    }
  });

  it("stops early when two consecutive rounds produce no new content", async () => {
    const originalFlag = process.env.AGENT_ORCHESTRATOR_ENABLED;
    process.env.AGENT_ORCHESTRATOR_ENABLED = "0";

    const runAutoToolSpy = vi
      .spyOn(agentLoopInternal, "runAutoTool")
      .mockResolvedValue({
        status: "succeeded",
        summary: { error: "NO_RESULTS" },
      });

    mocks.streamChat
      .mockResolvedValueOnce(
        makeStreamResult({
          deltas: [{ content: "第1轮：列出文件。" }],
          toolCalls: [
            {
              id: "tu-list-1",
              name: "project_files.list",
              input: { projectId: "project-1", round: 1 },
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        makeStreamResult({
          deltas: [{ content: "第2轮：再次列出文件。" }],
          toolCalls: [
            {
              id: "tu-list-2",
              name: "project_files.list",
              input: { projectId: "project-1", round: 2 },
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        makeStreamResult({
          deltas: [{ content: "最终回答" }],
        })
      );

    try {
      const response = await POST(
        new NextRequest("http://localhost/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: "列出项目资料",
            model: "deepseek-v4-pro",
            thinkingEnabled: true,
            reasoningEffort: "max",
            projectId: "project-1",
            selectedFileIds: [],
            mode: "review",
          }),
        })
      );

      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toContain("最终回答");
      expect(mocks.streamChat).toHaveBeenCalledTimes(3);

      const wrapUpCall = mocks.streamChat.mock.calls[2];
      const wrapUpRequest = wrapUpCall[1] as {
        messages: Array<{ role: string; content: string | unknown }>;
      };
      const messagesText = JSON.stringify(wrapUpRequest.messages);
      expect(messagesText).toContain("连续两轮工具调用未产生新信息");
    } finally {
      runAutoToolSpy.mockRestore();
      if (originalFlag === undefined) {
        delete process.env.AGENT_ORCHESTRATOR_ENABLED;
      } else {
        process.env.AGENT_ORCHESTRATOR_ENABLED = originalFlag;
      }
    }
  });

  it("runs the tool loop when the orchestrator is enabled", async () => {
    const originalFlag = process.env.AGENT_ORCHESTRATOR_ENABLED;
    process.env.AGENT_ORCHESTRATOR_ENABLED = "1";

    mocks.streamChat
      .mockResolvedValueOnce(
        makeStreamResult({
          deltas: [{ content: "我先看资料。" }],
          toolCalls: [
            {
              id: "tu-1",
              name: "project_files.list",
              input: { projectId: "project-1" },
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        makeStreamResult({
          deltas: [{ content: "最终回答" }],
        })
      );

    try {
      const response = await POST(
        new NextRequest("http://localhost/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: "基于项目资料写论文提纲",
            model: "deepseek-v4-pro",
            thinkingEnabled: true,
            reasoningEffort: "max",
            projectId: "project-1",
            selectedFileIds: [],
            mode: "review",
          }),
        })
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("X-Agent-Orchestrator")).toBe("enabled");
      expect(mocks.streamChat).toHaveBeenCalledTimes(2);
      expect(mocks.toolExecutionCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            toolId: "project_files.list",
            status: "proposed",
          }),
        })
      );
    } finally {
      if (originalFlag === undefined) {
        delete process.env.AGENT_ORCHESTRATOR_ENABLED;
      } else {
        process.env.AGENT_ORCHESTRATOR_ENABLED = originalFlag;
      }
    }
  });

  it("executes MiniMax native tool_use blocks and streams the final answer", async () => {
    const originalFlag = process.env.AGENT_ORCHESTRATOR_ENABLED;
    process.env.AGENT_ORCHESTRATOR_ENABLED = "0";

    mocks.streamMiniMaxChat
      .mockResolvedValueOnce(
        makeStreamResult({
          deltas: [{ content: "我先" }, { content: "查看资料。" }],
          toolCalls: [
            {
              id: "tu-1",
              name: "project_files.list",
              input: { projectId: "project-1" },
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        makeStreamResult({
          deltas: [{ content: "最终" }, { content: "论文提纲" }],
        })
      );

    try {
      const response = await POST(
        new NextRequest("http://localhost/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: "基于项目资料写论文提纲",
            model: "minimax-m3",
            thinkingEnabled: true,
            reasoningEffort: "max",
            projectId: "project-1",
            selectedFileIds: [],
            mode: "review",
          }),
        })
      );

      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toContain("最终");
      expect(body).toContain("论文提纲");
      expect(body).not.toContain("<tool_calls>");
      expect(mocks.streamMiniMaxChat).toHaveBeenCalledTimes(2);
      expect(mocks.streamMiniMaxChat).toHaveBeenCalledWith(
        "sk-test",
        expect.objectContaining({
          tools: expect.arrayContaining([
            expect.objectContaining({ name: "project_files.list" }),
          ]),
        })
      );
      expect(mocks.toolExecutionCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            toolId: "project_files.list",
            status: "proposed",
          }),
        })
      );
      expect(body.match(/data:/g)?.length).toBeGreaterThan(2);
    } finally {
      if (originalFlag === undefined) {
        delete process.env.AGENT_ORCHESTRATOR_ENABLED;
      } else {
        process.env.AGENT_ORCHESTRATOR_ENABLED = originalFlag;
      }
    }
  });
});

describe("accumulateAndSave sanitization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.messageUpdate.mockResolvedValue({});
  });

  it("persists sanitized content and reasoning without tool markup", async () => {
    const stream = makeSSEStream([
      { content: "正文" },
      { content: '<tool_calls><invoke name="x"></invoke></tool_calls>' },
      { reasoning_content: "思考" },
      {
        reasoning_content:
          '<| | DSML | | invoke name="y"><| | DSML | | parameter name="z">1</| | DSML | | parameter></| | DSML | | invoke>',
      },
    ]);

    await accumulateAndSave(
      stream,
      "conversation-1",
      "message-1",
      "user-1",
      "deepseek-v4-pro",
      "deepseek",
      () => ({
        prompt_tokens: 10,
        completion_tokens: 2,
        total_tokens: 12,
      })
    );

    expect(mocks.messageUpdate).toHaveBeenCalledWith({
      where: { id: "message-1" },
      data: expect.objectContaining({
        content: "正文",
        reasoningContent: "思考",
      }),
    });
    const updateCall = mocks.messageUpdate.mock.calls.find(
      (call) => call[0].where.id === "message-1"
    );
    const data = updateCall?.[0].data as Record<string, unknown>;
    expect(String(data.content)).not.toContain("<tool_calls>");
    expect(String(data.content)).not.toContain("invoke name");
    expect(String(data.reasoningContent)).not.toContain("DSML");
    expect(String(data.reasoningContent)).not.toContain("<|");
  });
});
