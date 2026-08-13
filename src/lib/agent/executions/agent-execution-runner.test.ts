import { describe, expect, it, vi } from "vitest";

import type {
  AgentCheckpoint,
  AgentExecutionRecord,
} from "./agent-execution-store";
import {
  AgentExecutionFaultInjectionCrash,
  AgentExecutionRunner,
} from "./agent-execution-runner";
import { AgentRuntimeError } from "@/lib/agent/runtime";
import { AgentExecutionRetryPolicy } from "./retry-policy";

function checkpoint(round = 0): AgentCheckpoint {
  return {
    version: 1,
    messages: [],
    round,
    model: { provider: "deepseek", name: "deepseek-v4-pro" },
    skill: { id: null, version: null },
    rag: { sourceIds: [], selectedFileIds: [] },
    allowedToolIds: [],
  };
}

function claimedExecution(
  overrides: Partial<AgentExecutionRecord> = {}
): AgentExecutionRecord {
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
    status: "running",
    checkpoint: checkpoint(),
    waitingToolExecutionId: null,
    scheduledAt: now,
    leaseOwner: "worker-a",
    leaseExpiresAt: new Date("2026-07-31T00:00:30.000Z"),
    attempt: 1,
    lastEventSequence: 2,
    failure: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createStore() {
  return {
    saveCheckpoint: vi.fn().mockResolvedValue(true),
    appendEvent: vi.fn(),
    markCompleted: vi.fn().mockResolvedValue(true),
    markWaitingForApproval: vi.fn().mockResolvedValue(true),
    markFailed: vi.fn().mockResolvedValue(true),
    markCancelled: vi.fn().mockResolvedValue(true),
    scheduleRetry: vi.fn().mockResolvedValue(true),
  };
}

function retryPolicy() {
  return new AgentExecutionRetryPolicy({
    maxAttempts: 3,
    baseDelayMs: 1_000,
    maxDelayMs: 30_000,
  });
}

describe("AgentExecutionRunner", () => {
  it("completes through the lease-fenced store using the handler checkpoint", async () => {
    const store = createStore();
    const finalCheckpoint = checkpoint(2);
    const handler = vi.fn().mockResolvedValue({
      kind: "completed",
      checkpoint: finalCheckpoint,
    });
    const runner = new AgentExecutionRunner({
      store,
      handler,
      retryPolicy: retryPolicy(),
      now: () => new Date("2026-07-31T00:00:05.000Z"),
    });

    await expect(
      runner.run({
        execution: claimedExecution(),
        workerId: "worker-a",
        signal: new AbortController().signal,
      })
    ).resolves.toEqual({ state: "completed" });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        execution: expect.objectContaining({ id: "run-1" }),
        signal: expect.any(AbortSignal),
        saveCheckpoint: expect.any(Function),
        appendEvent: expect.any(Function),
      })
    );
    expect(store.markCompleted).toHaveBeenCalledWith({
      executionId: "run-1",
      workerId: "worker-a",
      now: new Date("2026-07-31T00:00:05.000Z"),
      checkpoint: finalCheckpoint,
    });
  });

  it("does not invoke the handler for a stale claimed record", async () => {
    const store = createStore();
    const handler = vi.fn();
    const runner = new AgentExecutionRunner({
      store,
      handler,
      retryPolicy: retryPolicy(),
      now: () => new Date("2026-07-31T00:00:31.000Z"),
    });

    await expect(
      runner.run({
        execution: claimedExecution(),
        workerId: "worker-a",
        signal: new AbortController().signal,
      })
    ).resolves.toEqual({ state: "lease_lost" });
    expect(handler).not.toHaveBeenCalled();
    expect(store.markCompleted).not.toHaveBeenCalled();
  });

  it("schedules a bounded retry for a retryable handler failure", async () => {
    const store = createStore();
    const runner = new AgentExecutionRunner({
      store,
      handler: vi.fn().mockResolvedValue({
        kind: "failed",
        code: "provider_unavailable",
        message: "temporary",
        retryable: true,
        checkpoint: checkpoint(1),
      }),
      retryPolicy: retryPolicy(),
      now: () => new Date("2026-07-31T00:00:05.000Z"),
    });

    await expect(
      runner.run({
        execution: claimedExecution({ attempt: 1 }),
        workerId: "worker-a",
        signal: new AbortController().signal,
      })
    ).resolves.toEqual({
      state: "retry_scheduled",
      scheduledAt: new Date("2026-07-31T00:00:06.000Z"),
    });
    expect(store.scheduleRetry).toHaveBeenCalledWith({
      executionId: "run-1",
      workerId: "worker-a",
      failure: {
        code: "provider_unavailable",
        message: "temporary",
        retryable: true,
        attempt: 1,
      },
      scheduledAt: new Date("2026-07-31T00:00:06.000Z"),
      now: new Date("2026-07-31T00:00:05.000Z"),
      checkpoint: checkpoint(1),
    });
  });

  it("marks the final retryable failure as poison instead of requeueing", async () => {
    const store = createStore();
    const runner = new AgentExecutionRunner({
      store,
      handler: vi.fn().mockRejectedValue(new Error("provider timed out")),
      retryPolicy: retryPolicy(),
      now: () => new Date("2026-07-31T00:00:05.000Z"),
    });

    await expect(
      runner.run({
        execution: claimedExecution({ attempt: 3 }),
        workerId: "worker-a",
        signal: new AbortController().signal,
      })
    ).resolves.toEqual({ state: "failed" });
    expect(store.scheduleRetry).not.toHaveBeenCalled();
    expect(store.markFailed).toHaveBeenCalledWith({
      executionId: "run-1",
      workerId: "worker-a",
      failure: {
        code: "execution_error",
        message: "provider timed out",
        retryable: false,
        attempt: 3,
      },
      now: new Date("2026-07-31T00:00:05.000Z"),
    });
  });

  it("fails fast on a deterministic AgentRuntimeError without scheduling a retry", async () => {
    const store = createStore();
    const runner = new AgentExecutionRunner({
      store,
      handler: vi
        .fn()
        .mockRejectedValue(
          new AgentRuntimeError(
            400,
            "当前项目没有可读取的已解析资料，请先上传资料并等待解析完成。"
          )
        ),
      retryPolicy: retryPolicy(),
      now: () => new Date("2026-07-31T00:00:05.000Z"),
    });

    await expect(
      runner.run({
        execution: claimedExecution({ attempt: 1 }),
        workerId: "worker-a",
        signal: new AbortController().signal,
      })
    ).resolves.toEqual({ state: "failed" });
    expect(store.scheduleRetry).not.toHaveBeenCalled();
    expect(store.markFailed).toHaveBeenCalledWith({
      executionId: "run-1",
      workerId: "worker-a",
      failure: {
        code: "execution_error",
        message: "当前项目没有可读取的已解析资料，请先上传资料并等待解析完成。",
        retryable: false,
        attempt: 1,
      },
      now: new Date("2026-07-31T00:00:05.000Z"),
    });
  });

  it("keeps provider-mapped 429 failures retryable", async () => {
    const store = createStore();
    const runner = new AgentExecutionRunner({
      store,
      handler: vi.fn().mockRejectedValue(
        new AgentRuntimeError(429, "rate limited", { deepseekStatus: 429 })
      ),
      retryPolicy: retryPolicy(),
      now: () => new Date("2026-07-31T00:00:05.000Z"),
    });

    await expect(
      runner.run({
        execution: claimedExecution({ attempt: 1 }),
        workerId: "worker-a",
        signal: new AbortController().signal,
      })
    ).resolves.toEqual({
      state: "retry_scheduled",
      scheduledAt: new Date("2026-07-31T00:00:06.000Z"),
    });
    expect(store.markFailed).not.toHaveBeenCalled();
  });

  it("fails fast on provider 4xx errors like insufficient balance", async () => {
    const store = createStore();
    const runner = new AgentExecutionRunner({
      store,
      handler: vi.fn().mockRejectedValue(
        new AgentRuntimeError(402, "insufficient balance", { deepseekStatus: 402 })
      ),
      retryPolicy: retryPolicy(),
      now: () => new Date("2026-07-31T00:00:05.000Z"),
    });

    await expect(
      runner.run({
        execution: claimedExecution({ attempt: 1 }),
        workerId: "worker-a",
        signal: new AbortController().signal,
      })
    ).resolves.toEqual({ state: "failed" });
    expect(store.scheduleRetry).not.toHaveBeenCalled();
  });

  it("redacts credentials before persisting an execution failure", async () => {
    const store = createStore();
    const runner = new AgentExecutionRunner({
      store,
      handler: vi
        .fn()
        .mockRejectedValue(
          new Error(
            "Authorization: Basic abc123 password=hunter2 postgresql://user:dbpass@example.test/db"
          )
        ),
      retryPolicy: retryPolicy(),
      now: () => new Date("2026-07-31T00:00:05.000Z"),
    });

    await runner.run({
      execution: claimedExecution({ attempt: 3 }),
      workerId: "worker-a",
      signal: new AbortController().signal,
    });

    const persisted = store.markFailed.mock.calls[0][0].failure as {
      message: string;
    };
    expect(persisted.message).toContain("[redacted]");
    expect(persisted.message).not.toContain("abc123");
    expect(persisted.message).not.toContain("hunter2");
    expect(persisted.message).not.toContain("dbpass");
  });

  it("exposes a crash hook that leaves the claimed execution untouched", async () => {
    const store = createStore();
    const runner = new AgentExecutionRunner({
      store,
      handler: vi.fn().mockResolvedValue({ kind: "completed" }),
      retryPolicy: retryPolicy(),
      now: () => new Date("2026-07-31T00:00:05.000Z"),
      hooks: {
        afterHandler: () => {
          throw new AgentExecutionFaultInjectionCrash("after-handler");
        },
      },
    });

    await expect(
      runner.run({
        execution: claimedExecution(),
        workerId: "worker-a",
        signal: new AbortController().signal,
      })
    ).rejects.toMatchObject({ point: "after-handler" });
    expect(store.markCompleted).not.toHaveBeenCalled();
    expect(store.scheduleRetry).not.toHaveBeenCalled();
  });
});
