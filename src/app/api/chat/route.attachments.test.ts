// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  checkRateLimit: vi.fn(),
  resolveStoredChatModel: vi.fn(),
  run: vi.fn(),
  persistChatAttachments: vi.fn(),
  bindChatAttachmentsToMessage: vi.fn(),
  toMediaRef: vi.fn(),
  encodeChatAttachmentsHeader: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  RateLimits: { CHAT: { max: 100, window: 60 } },
}));
vi.mock("@/lib/data/chat-model-preference", () => ({
  resolveStoredChatModel: mocks.resolveStoredChatModel,
}));
vi.mock("@/lib/agent/runtime", () => ({
  agentRuntime: { run: mocks.run },
  AgentRuntimeError: class AgentRuntimeError extends Error {
    status = 500;
    details = {};
  },
}));
vi.mock("@/lib/chat/message-attachments", () => ({
  persistChatAttachments: mocks.persistChatAttachments,
  bindChatAttachmentsToMessage: mocks.bindChatAttachmentsToMessage,
  toMediaRef: mocks.toMediaRef,
  encodeChatAttachmentsHeader: mocks.encodeChatAttachmentsHeader,
}));
vi.mock("@/lib/learning/feature-flags", () => ({
  learningFeatureFlags: { durableExecutionEnabled: false },
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: mocks.loggerError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/agent/executions/durable-chat-dispatcher", () => ({
  dispatchDurableChat: vi.fn(),
}));
vi.mock("@/lib/agent/executions/durable-response-stream", () => ({
  createDurableReplayResponse: vi.fn(),
}));
vi.mock("@/lib/agent/executions/durable-agent-runtime", () => ({
  startAgentExecutionWorker: vi.fn(),
}));
vi.mock("@/lib/agent/executions/agent-execution-store", () => ({
  AgentExecutionStoreError: class AgentExecutionStoreError extends Error {
    code = "execution_not_found";
  },
}));

import { POST } from "@/app/api/chat/route";

const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("fake-png-body"),
]);

function chatRequest() {
  const form = new FormData();
  form.append(
    "message",
    JSON.stringify({
      clientRunKey: "3f1e6b1c-9f4e-4c2a-8f2f-6b8b0f0c1d2e",
      message: "这张图里是什么",
      model: "deepseek-v4-flash-vision-exp",
      thinkingEnabled: true,
      reasoningEffort: "high",
    })
  );
  form.append("attachments", new File([new Uint8Array(PNG_BYTES)], "red.png", {
    type: "image/png",
  }));
  return new NextRequest("http://localhost/api/chat", {
    method: "POST",
    body: form,
  });
}

function streamResponse() {
  return {
    metadata: {
      conversationId: "conversation-1",
      messageId: "message-assistant",
      provider: "deepseek",
      model: "deepseek-v4-flash-vision-exp",
      runtimeMode: "new",
      runtimeVersion: "1",
      toolProtocol: "native",
    },
    events: (async function* () {})(),
    completion: Promise.resolve({
      status: "completed" as const,
      conversationId: "conversation-1",
      messageId: "message-assistant",
      provider: "deepseek" as const,
      model: "deepseek-v4-flash-vision-exp" as const,
      usage: null,
      sources: [],
    }),
  };
}

function persistedRow() {
  return {
    id: "att-1",
    originalName: "red.png",
    mimeType: "image/png",
    size: PNG_BYTES.length,
    width: 12,
    height: 8,
    contentHash: "hash-1",
    storageProvider: "local",
    storagePath: "chat-attachments/user-1/run/0-abc.png",
    position: 0,
    status: "pending",
    hasThumbnail: true,
  };
}

describe("POST /api/chat attachment persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.checkRateLimit.mockResolvedValue({ allowed: true });
    mocks.resolveStoredChatModel.mockResolvedValue("deepseek-v4-flash-vision-exp");
    mocks.persistChatAttachments.mockResolvedValue([persistedRow()]);
    mocks.toMediaRef.mockReturnValue({
      source: "message-attachment",
      id: "att-1",
      originalName: "red.png",
      mimeType: "image/png",
      storageProvider: "local",
      storagePath: "chat-attachments/user-1/run/0-abc.png",
      contentHash: "hash-1",
    });
    mocks.encodeChatAttachmentsHeader.mockReturnValue('[{"id":"att-1"}]');
    mocks.run.mockResolvedValue(streamResponse());
  });

  it("persists image attachments before running and exposes them in a response header", async () => {
    const response = await POST(chatRequest());

    expect(response.status).toBe(200);
    expect(mocks.persistChatAttachments).toHaveBeenCalledWith({
      userId: "user-1",
      clientRunKey: "3f1e6b1c-9f4e-4c2a-8f2f-6b8b0f0c1d2e",
      attachments: [
        {
          name: "red.png",
          mimeType: "image/png",
          size: PNG_BYTES.length,
          data: PNG_BYTES,
        },
      ],
    });
    expect(response.headers.get("X-Message-Attachments")).toBe(
      '[{"id":"att-1"}]'
    );

    const runInput = mocks.run.mock.calls[0][0];
    expect(runInput.clientRunKey).toBe(
      "3f1e6b1c-9f4e-4c2a-8f2f-6b8b0f0c1d2e"
    );
    expect(runInput.prompt.mediaRefs).toEqual([mocks.toMediaRef.mock.results[0].value]);
    expect(runInput.prompt.attachments).toHaveLength(1);
  });

  it("fails closed with 503 and keeps the draft when persistence fails", async () => {
    mocks.persistChatAttachments.mockRejectedValue(new Error("storage down"));

    const response = await POST(chatRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("图片附件保存失败"),
    });
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.loggerError).toHaveBeenCalled();
  });

  it("does not persist or add a header when there are no attachments", async () => {
    const request = new NextRequest("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientRunKey: "3f1e6b1c-9f4e-4c2a-8f2f-6b8b0f0c1d2e",
        message: "只发文字",
        model: "deepseek-v4-flash-vision-exp",
        thinkingEnabled: true,
        reasoningEffort: "high",
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mocks.persistChatAttachments).not.toHaveBeenCalled();
    expect(response.headers.get("X-Message-Attachments")).toBeNull();
    expect(mocks.run.mock.calls[0][0].prompt.mediaRefs).toBeUndefined();
  });
});
