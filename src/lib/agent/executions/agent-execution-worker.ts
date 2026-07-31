import type {
  AgentExecutionRecord,
  AgentExecutionStore,
} from "./agent-execution-store";
import type {
  AgentExecutionRunner,
  AgentExecutionRunnerResult,
} from "./agent-execution-runner";
import type { AgentExecutionRetryPolicy } from "./retry-policy";

type WorkerStore = Pick<
  AgentExecutionStore,
  "claimNext" | "recoverExpired" | "renewLease" | "reconcileWaitingApprovals"
>;

type WorkerRunner = Pick<AgentExecutionRunner, "run">;

export type AgentExecutionWorkerSleep = (
  milliseconds: number,
  signal: AbortSignal
) => Promise<void>;

function assertPositiveFinite(value: number, name: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive finite number`);
  }
}

function defaultSleep(
  milliseconds: number,
  signal: AbortSignal
): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const finish = () => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      finish();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Process-local execution worker.
 *
 * Database leases, not this object, arbitrate work across processes. Stopping
 * the worker only stops new claims and waits for an active run; it deliberately
 * does not turn transport detachment or a graceful shutdown into user cancel.
 */
export class AgentExecutionWorker {
  private readonly workerId: string;
  private readonly store: WorkerStore;
  private readonly runner: WorkerRunner;
  private readonly retryPolicy: AgentExecutionRetryPolicy;
  private readonly leaseMs: number;
  private readonly heartbeatMs: number;
  private readonly pollIntervalMs: number;
  private readonly now: () => Date;
  private readonly sleep: AgentExecutionWorkerSleep;
  private loopPromise: Promise<void> | null = null;
  private idleController: AbortController | null = null;
  private stopRequested = false;

  constructor(input: {
    workerId: string;
    store: WorkerStore;
    runner: WorkerRunner;
    retryPolicy: AgentExecutionRetryPolicy;
    leaseMs: number;
    heartbeatMs: number;
    pollIntervalMs: number;
    now?: () => Date;
    sleep?: AgentExecutionWorkerSleep;
  }) {
    const workerId = input.workerId.trim();
    if (!workerId) throw new Error("workerId must not be empty");
    assertPositiveFinite(input.leaseMs, "leaseMs");
    assertPositiveFinite(input.heartbeatMs, "heartbeatMs");
    assertPositiveFinite(input.pollIntervalMs, "pollIntervalMs");
    if (input.heartbeatMs >= input.leaseMs) {
      throw new Error("heartbeatMs must be less than leaseMs");
    }

    this.workerId = workerId;
    this.store = input.store;
    this.runner = input.runner;
    this.retryPolicy = input.retryPolicy;
    this.leaseMs = input.leaseMs;
    this.heartbeatMs = input.heartbeatMs;
    this.pollIntervalMs = input.pollIntervalMs;
    this.now = input.now ?? (() => new Date());
    this.sleep = input.sleep ?? defaultSleep;
  }

  get isRunning(): boolean {
    return this.loopPromise !== null;
  }

  start(): Promise<void> {
    if (this.loopPromise) return this.loopPromise;
    this.stopRequested = false;
    const loop = this.runLoop();
    this.loopPromise = loop.finally(() => {
      this.idleController = null;
      this.loopPromise = null;
    });
    return this.loopPromise;
  }

  async stop(): Promise<void> {
    this.stopRequested = true;
    this.idleController?.abort();
    const activeLoop = this.loopPromise;
    if (activeLoop) await activeLoop;
  }

  async drain(maxRuns = 1_000): Promise<number> {
    if (!Number.isInteger(maxRuns) || maxRuns <= 0) {
      throw new Error("maxRuns must be a positive integer");
    }
    let processed = 0;
    while (processed < maxRuns && (await this.drainOnce())) {
      processed += 1;
    }
    return processed;
  }

  async drainOnce(): Promise<boolean> {
    await this.store.reconcileWaitingApprovals({ now: this.now(), limit: 100 });
    const execution = await this.store.claimNext({
      workerId: this.workerId,
      now: this.now(),
      leaseMs: this.leaseMs,
    });
    if (!execution) return false;

    await this.runWithHeartbeat(execution);
    return true;
  }

  private async runLoop(): Promise<void> {
    await this.store.recoverExpired({
      now: this.now(),
      maxAttempts: this.retryPolicy.maxAttempts,
      retryDelayMs: (attempt) => {
        const decision = this.retryPolicy.decide({
          attempt,
          now: this.now(),
        });
        return decision.action === "retry" ? decision.delayMs : 0;
      },
    });

    while (!this.stopRequested) {
      const processed = await this.drainOnce();
      if (processed || this.stopRequested) continue;

      const idleController = new AbortController();
      this.idleController = idleController;
      await this.sleep(this.pollIntervalMs, idleController.signal);
      if (this.idleController === idleController) {
        this.idleController = null;
      }
    }
  }

  private async runWithHeartbeat(
    execution: AgentExecutionRecord
  ): Promise<AgentExecutionRunnerResult> {
    const heartbeatStop = new AbortController();
    const leaseLost = new AbortController();
    const heartbeat = this.heartbeat(
      execution.id,
      heartbeatStop.signal,
      leaseLost
    );

    try {
      return await this.runner.run({
        execution,
        workerId: this.workerId,
        signal: leaseLost.signal,
      });
    } finally {
      heartbeatStop.abort();
      await heartbeat;
    }
  }

  private async heartbeat(
    executionId: string,
    stopSignal: AbortSignal,
    leaseLost: AbortController
  ): Promise<void> {
    while (!stopSignal.aborted) {
      await this.sleep(this.heartbeatMs, stopSignal);
      if (stopSignal.aborted) return;

      let renewed = false;
      try {
        renewed = await this.store.renewLease({
          executionId,
          workerId: this.workerId,
          now: this.now(),
          leaseMs: this.leaseMs,
        });
      } catch {
        renewed = false;
      }
      if (!renewed) {
        leaseLost.abort();
        return;
      }
    }
  }
}
