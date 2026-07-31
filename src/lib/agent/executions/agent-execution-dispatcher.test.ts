import { describe, expect, it, vi } from "vitest";

import type {
  AgentCheckpoint,
  AgentExecutionRecord,
} from "./agent-execution-store";
import { AgentExecutionDispatcher } from "./agent-execution-dispatcher";

function checkpoint(): AgentCheckpoint {
  return {
    version: 1,
    messages: [],
    round: 0,
    model: { provider: "deepseek", name: "deepseek-v4-pro" },
    skill: { id: null, version: null },
    rag: { sourceIds: [], selectedFileIds: [] },
    allowedToolIds: [],
  };
}

function execution(): AgentExecutionRecord {
  const now = new Date("2026-07-31T00:00:00.000Z");
  return {
    id: "run-1",
    userId: "user-1",
    clientRunKey: "client-run-1",
    requestHash: "sha256:request-1",
    userMessageId: "message-user-1",
    assistantMessageId: "message-assistant-1",
    conversationId: "conversation-1",
    projectId: null,
    status: "queued",
    checkpoint: checkpoint(),
    waitingToolExecutionId: null,
    scheduledAt: now,
    leaseOwner: null,
    leaseExpiresAt: null,
    attempt: 0,
    lastEventSequence: 1,
    failure: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe("AgentExecutionDispatcher", () => {
  it("dispatches one stable request without depending on a transport signal", async () => {
    const createOrGetByClientRunKey = vi.fn().mockResolvedValue({
      execution: execution(),
      created: true,
    });
    const dispatcher = new AgentExecutionDispatcher({
      createOrGetByClientRunKey,
    });

    const result = await dispatcher.dispatch({
      userId: "user-1",
      clientRunKey: "client-run-1",
      requestHash: "sha256:request-1",
      conversation: {
        id: "conversation-1",
        title: "Existing",
        model: "deepseek-v4-pro",
        thinkingEnabled: true,
      },
      userMessageContent: "Explain Kirchhoff's law",
      checkpoint: checkpoint(),
      scheduledAt: new Date("2026-07-31T00:00:00.000Z"),
    });

    expect(result).toMatchObject({
      created: true,
      execution: { id: "run-1" },
    });
    expect(createOrGetByClientRunKey).toHaveBeenCalledWith(
      expect.not.objectContaining({ signal: expect.anything() })
    );
  });

  it("rejects an empty client run key before opening a transaction", async () => {
    const createOrGetByClientRunKey = vi.fn();
    const dispatcher = new AgentExecutionDispatcher({
      createOrGetByClientRunKey,
    });

    await expect(
      dispatcher.dispatch({
        userId: "user-1",
        clientRunKey: "   ",
        requestHash: "sha256:request-1",
        conversation: {
          title: "New chat",
          model: "deepseek-v4-pro",
          thinkingEnabled: true,
        },
        userMessageContent: "Hello",
        checkpoint: checkpoint(),
      })
    ).rejects.toThrow("clientRunKey must not be empty");
    expect(createOrGetByClientRunKey).not.toHaveBeenCalled();
  });
});
