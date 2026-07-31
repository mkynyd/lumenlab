import { describe, expect, it, vi } from "vitest";

import type {
  AgentExecutionEventRecord,
  AgentExecutionRecord,
} from "./agent-execution-store";
import { replayAgentExecutionEvents } from "./event-replay";

function execution(
  overrides: Partial<AgentExecutionRecord> = {}
): AgentExecutionRecord {
  const now = new Date("2026-07-31T00:00:00.000Z");
  return {
    id: "run-1",
    userId: "user-1",
    clientRunKey: "client-1",
    requestHash: "sha256:request",
    userMessageId: "message-user",
    assistantMessageId: "message-assistant",
    conversationId: "conversation-1",
    projectId: null,
    status: "completed",
    checkpoint: null,
    waitingToolExecutionId: null,
    scheduledAt: now,
    leaseOwner: null,
    leaseExpiresAt: null,
    attempt: 1,
    lastEventSequence: 4,
    failure: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function event(
  sequence: number,
  type = "assistant_text"
): AgentExecutionEventRecord {
  return {
    id: `event-${sequence}`,
    executionId: "run-1",
    sequence,
    key: `${type}:${sequence}`,
    type,
    payload: { text: `chunk-${sequence}` },
    createdAt: new Date("2026-07-31T00:00:00.000Z"),
  };
}

describe("agent execution event replay", () => {
  it("returns only records after the cursor and closes at terminal state", async () => {
    const store = {
      listEventsAfter: vi.fn().mockResolvedValue([event(3), event(4, "run_completed")]),
      getOwnedExecution: vi.fn().mockResolvedValue(execution()),
    };

    const received = [];
    for await (const item of replayAgentExecutionEvents({
      store,
      userId: "user-1",
      executionId: "run-1",
      afterSequence: 2,
    })) {
      received.push(item);
    }

    expect(received.map((item) => item.sequence)).toEqual([3, 4]);
    expect(store.listEventsAfter).toHaveBeenCalledWith({
      executionId: "run-1",
      userId: "user-1",
      afterSequence: 2,
      limit: 100,
    });
  });

  it("does not replay a terminal event twice after reconnect", async () => {
    const store = {
      listEventsAfter: vi.fn().mockResolvedValue([]),
      getOwnedExecution: vi.fn().mockResolvedValue(execution()),
    };

    const received = [];
    for await (const item of replayAgentExecutionEvents({
      store,
      userId: "user-1",
      executionId: "run-1",
      afterSequence: 4,
    })) {
      received.push(item);
    }

    expect(received).toEqual([]);
  });

  it("reports an owner-scoped miss without cancelling the run", async () => {
    const store = {
      listEventsAfter: vi.fn().mockResolvedValue(null),
      getOwnedExecution: vi.fn(),
    };
    const controller = new AbortController();
    const received: unknown[] = [];

    await expect(async () => {
      for await (const item of replayAgentExecutionEvents({
        store,
        userId: "other-user",
        executionId: "run-1",
        afterSequence: 0,
        signal: controller.signal,
      })) {
        received.push(item);
      }
    }).rejects.toMatchObject({ code: "execution_not_found" });
    expect(received).toEqual([]);
    expect(controller.signal.aborted).toBe(false);
  });
});
