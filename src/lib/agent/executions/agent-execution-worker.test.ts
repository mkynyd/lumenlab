import { describe, expect, it, vi } from "vitest";

import type {
  AgentCheckpoint,
  AgentExecutionRecord,
} from "./agent-execution-store";
import { AgentExecutionWorker } from "./agent-execution-worker";
import { AgentExecutionRetryPolicy } from "./retry-policy";

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

function claimedExecution(): AgentExecutionRecord {
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
  };
}

function retryPolicy() {
  return new AgentExecutionRetryPolicy({
    maxAttempts: 3,
    baseDelayMs: 1_000,
    maxDelayMs: 30_000,
  });
}

function abortableSleep(_ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

describe("AgentExecutionWorker", () => {
  it("claims and drains one execution independently of an HTTP transport", async () => {
    const execution = claimedExecution();
    const store = {
      claimNext: vi.fn().mockResolvedValue(execution),
      recoverExpired: vi.fn(),
      renewLease: vi.fn(),
      reconcileWaitingApprovals: vi.fn().mockResolvedValue(0),
    };
    const runner = {
      run: vi.fn().mockResolvedValue({ state: "completed" }),
    };
    const worker = new AgentExecutionWorker({
      workerId: "worker-a",
      store,
      runner,
      retryPolicy: retryPolicy(),
      leaseMs: 30_000,
      heartbeatMs: 10_000,
      pollIntervalMs: 1_000,
      now: () => new Date("2026-07-31T00:00:00.000Z"),
      sleep: abortableSleep,
    });

    await expect(worker.drainOnce()).resolves.toBe(true);
    expect(store.claimNext).toHaveBeenCalledWith({
      workerId: "worker-a",
      now: new Date("2026-07-31T00:00:00.000Z"),
      leaseMs: 30_000,
    });
    expect(runner.run).toHaveBeenCalledWith({
      execution,
      workerId: "worker-a",
      signal: expect.any(AbortSignal),
    });
  });

  it("aborts the runner when heartbeat proves the lease was lost", async () => {
    const execution = claimedExecution();
    const store = {
      claimNext: vi.fn().mockResolvedValue(execution),
      recoverExpired: vi.fn(),
      renewLease: vi.fn().mockResolvedValue(false),
      reconcileWaitingApprovals: vi.fn().mockResolvedValue(0),
    };
    const runner = {
      run: vi.fn(
        ({ signal }: { signal: AbortSignal }) =>
          new Promise<{ state: "lease_lost" }>((resolve) => {
            if (signal.aborted) {
              resolve({ state: "lease_lost" });
              return;
            }
            signal.addEventListener(
              "abort",
              () => resolve({ state: "lease_lost" }),
              { once: true }
            );
          })
      ),
    };
    const worker = new AgentExecutionWorker({
      workerId: "worker-a",
      store,
      runner,
      retryPolicy: retryPolicy(),
      leaseMs: 30_000,
      heartbeatMs: 10_000,
      pollIntervalMs: 1_000,
      now: () => new Date("2026-07-31T00:00:05.000Z"),
      sleep: vi.fn().mockResolvedValue(undefined),
    });

    await expect(worker.drainOnce()).resolves.toBe(true);
    expect(store.renewLease).toHaveBeenCalledWith({
      executionId: "run-1",
      workerId: "worker-a",
      now: new Date("2026-07-31T00:00:05.000Z"),
      leaseMs: 30_000,
    });
    expect(
      (runner.run.mock.calls[0][0] as { signal: AbortSignal }).signal.aborted
    ).toBe(true);
  });
  it("tolerates transient renew failures instead of killing a healthy run", async () => {
    const execution = claimedExecution();
    let renewCalls = 0;
    let sawFailure = false;
    let sawSuccess = false;
    const renewLease = vi.fn(async () => {
      renewCalls += 1;
      // 让出事件循环,避免瞬时 sleep mock 导致的心跳紧循环饿死定时器
      await new Promise((r) => setTimeout(r, 1));
      const ok = renewCalls >= 3; // 前两次瞬时失败,第三次恢复
      if (ok) sawSuccess = true;
      else sawFailure = true;
      return ok;
    });
    const store = {
      claimNext: vi.fn().mockResolvedValue(execution),
      recoverExpired: vi.fn(),
      renewLease,
      reconcileWaitingApprovals: vi.fn().mockResolvedValue(0),
    };
    const runner = {
      run: vi.fn(
        ({ signal }: { signal: AbortSignal }) =>
          new Promise<{ state: "completed" }>((resolve) => {
            const poll = () => {
              if (signal.aborted) {
                resolve({ state: "lease_lost" as never });
                return;
              }
              if (renewCalls >= 3) {
                resolve({ state: "completed" });
                return;
              }
              setTimeout(poll, 2);
            };
            poll();
          })
      ),
    };
    const worker = new AgentExecutionWorker({
      workerId: "worker-a",
      store,
      runner,
      retryPolicy: retryPolicy(),
      leaseMs: 30_000,
      heartbeatMs: 10,
      pollIntervalMs: 1_000,
      now: () => new Date("2026-07-31T00:00:05.000Z"),
      sleep: vi.fn().mockResolvedValue(undefined),
    });

    await expect(worker.drainOnce()).resolves.toBe(true);
    await vi.waitFor(() => {
      expect(renewCalls).toBeGreaterThanOrEqual(3);
      expect(sawFailure).toBe(true);
      expect(sawSuccess).toBe(true);
    });
    expect(
      (runner.run.mock.calls[0][0] as { signal: AbortSignal }).signal.aborted
    ).toBe(false);
  });

  it("recovers expired runs once at startup and does not spawn a duplicate loop", async () => {
    const store = {
      claimNext: vi.fn().mockResolvedValue(null),
      recoverExpired: vi.fn().mockResolvedValue(2),
      renewLease: vi.fn(),
      reconcileWaitingApprovals: vi.fn().mockResolvedValue(0),
    };
    const runner = { run: vi.fn() };
    const worker = new AgentExecutionWorker({
      workerId: "worker-a",
      store,
      runner,
      retryPolicy: retryPolicy(),
      leaseMs: 30_000,
      heartbeatMs: 10_000,
      pollIntervalMs: 1_000,
      now: () => new Date("2026-07-31T00:00:05.000Z"),
      sleep: abortableSleep,
    });

    worker.start();
    worker.start();
    await vi.waitFor(() => expect(store.claimNext).toHaveBeenCalledTimes(1));
    await worker.stop();

    expect(store.recoverExpired).toHaveBeenCalledTimes(1);
    expect(store.recoverExpired).toHaveBeenCalledWith({
      now: new Date("2026-07-31T00:00:05.000Z"),
      maxAttempts: 3,
      retryDelayMs: expect.any(Function),
    });
    expect(runner.run).not.toHaveBeenCalled();
    expect(worker.isRunning).toBe(false);
  });

  it("waits for an active run during graceful stop without cancelling it", async () => {
    const execution = claimedExecution();
    let finishRun: (() => void) | undefined;
    const store = {
      claimNext: vi
        .fn()
        .mockResolvedValueOnce(execution)
        .mockResolvedValue(null),
      recoverExpired: vi.fn().mockResolvedValue(0),
      renewLease: vi.fn().mockResolvedValue(true),
      reconcileWaitingApprovals: vi.fn().mockResolvedValue(0),
    };
    const runner = {
      run: vi.fn(
        ({ signal }: { signal: AbortSignal }) =>
          new Promise<{ state: "completed" }>((resolve) => {
            finishRun = () => resolve({ state: "completed" });
            expect(signal.aborted).toBe(false);
          })
      ),
    };
    const worker = new AgentExecutionWorker({
      workerId: "worker-a",
      store,
      runner,
      retryPolicy: retryPolicy(),
      leaseMs: 30_000,
      heartbeatMs: 10_000,
      pollIntervalMs: 1_000,
      now: () => new Date("2026-07-31T00:00:05.000Z"),
      sleep: abortableSleep,
    });

    worker.start();
    await vi.waitFor(() => expect(runner.run).toHaveBeenCalledTimes(1));
    const stop = worker.stop();
    expect(
      (runner.run.mock.calls[0][0] as { signal: AbortSignal }).signal.aborted
    ).toBe(false);
    finishRun?.();
    await stop;

    expect(worker.isRunning).toBe(false);
  });
});
