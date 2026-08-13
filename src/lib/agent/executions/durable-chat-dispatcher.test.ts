import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fileFindMany: vi.fn(),
  executionFindFirst: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    fileAsset: { findMany: mocks.fileFindMany },
    agentExecution: { findFirst: mocks.executionFindFirst },
  },
}));

import { dispatchDurableChat } from "./durable-chat-dispatcher";
import type { AgentRunInput } from "@/lib/agent/contracts";

function runInput(conversationId: string): AgentRunInput {
  return {
    user: { id: "user-1" },
    conversation: { id: conversationId },
    prompt: { message: "hello", attachments: [] },
    model: {
      requestedModel: "deepseek-v4-pro",
      thinkingEnabled: true,
      reasoningEffort: "high",
    },
    capabilities: {
      webSearchActive: false,
      skillOff: false,
      selectedFileIds: [],
      isQuickTask: false,
    },
    signal: new AbortController().signal,
  };
}

function fakeStore() {
  return {
    createOrGetByClientRunKey: vi.fn().mockResolvedValue({
      execution: { id: "run-new", status: "queued" },
      created: true,
    }),
  } as unknown as { createOrGetByClientRunKey: ReturnType<typeof vi.fn> };
}

describe("dispatchDurableChat conversation guard", () => {
  it("dispatches when no active execution exists for the conversation", async () => {
    mocks.fileFindMany.mockResolvedValue([]);
    mocks.executionFindFirst.mockResolvedValue(null);
    const store = fakeStore();

    const result = await dispatchDurableChat({
      userId: "user-1",
      clientRunKey: "client-1",
      runInput: runInput("conversation-1"),
      store: store as never,
    });

    expect(result.created).toBe(true);
    expect(store.createOrGetByClientRunKey).toHaveBeenCalledOnce();
  });

  it("rejects with conversation_execution_in_progress when one is active", async () => {
    mocks.fileFindMany.mockResolvedValue([]);
    mocks.executionFindFirst.mockResolvedValue({ id: "run-active" });
    const store = fakeStore();

    await expect(
      dispatchDurableChat({
        userId: "user-1",
        clientRunKey: "client-2",
        runInput: runInput("conversation-1"),
        store: store as never,
      })
    ).rejects.toMatchObject({
      code: "conversation_execution_in_progress",
    });
    expect(store.createOrGetByClientRunKey).not.toHaveBeenCalled();
  });
});
