import type { Prisma } from "@/generated/prisma/client";
import type {
  AgentCheckpoint,
  AgentExecutionRecord,
  AgentExecutionStore,
} from "./agent-execution-store";
import { AgentExecutionStoreError } from "./agent-execution-store";
import { AgentRuntimeError } from "@/lib/agent/runtime";
import type { AgentExecutionRetryPolicy } from "./retry-policy";

type RunnerStore = Pick<
  AgentExecutionStore,
  | "saveCheckpoint"
  | "appendEvent"
  | "markCompleted"
  | "markWaitingForApproval"
  | "markFailed"
  | "markCancelled"
  | "scheduleRetry"
>;

export type AgentExecutionHandlerResult =
  | {
      kind: "completed";
      checkpoint?: AgentCheckpoint;
    }
  | {
      kind: "waiting_approval";
      toolExecutionId: string;
      checkpoint: AgentCheckpoint;
    }
  | {
      kind: "failed";
      code: string;
      message: string;
      retryable: boolean;
      checkpoint?: AgentCheckpoint;
    }
  | {
      kind: "cancelled";
      code?: string;
      message?: string;
      checkpoint?: AgentCheckpoint;
    };

export type AgentExecutionHandlerContext = {
  execution: AgentExecutionRecord;
  signal: AbortSignal;
  saveCheckpoint: (checkpoint: AgentCheckpoint) => Promise<void>;
  appendEvent: (input: {
    key: string;
    type: string;
    payload?: Prisma.InputJsonValue;
  }) => Promise<void>;
};

export type AgentExecutionHandler = (
  context: AgentExecutionHandlerContext
) => Promise<AgentExecutionHandlerResult>;

export type AgentExecutionRunnerResult =
  | { state: "completed" }
  | { state: "waiting_approval" }
  | { state: "retry_scheduled"; scheduledAt: Date }
  | { state: "failed" }
  | { state: "cancelled" }
  | { state: "lease_lost" };

export class AgentExecutionFaultInjectionCrash extends Error {
  constructor(public readonly point: string) {
    super(`Injected execution crash at ${point}`);
    this.name = "AgentExecutionFaultInjectionCrash";
  }
}

export type AgentExecutionRunnerHooks = {
  beforeHandler?: (execution: AgentExecutionRecord) => void | Promise<void>;
  afterHandler?: (
    result: AgentExecutionHandlerResult,
    execution: AgentExecutionRecord
  ) => void | Promise<void>;
  beforeTransition?: (
    result: AgentExecutionHandlerResult,
    execution: AgentExecutionRecord
  ) => void | Promise<void>;
};

export class LeaseLostDuringRun extends Error {}

function sanitizeFailureMessage(message: string): string {
  return message
    .replace(
      /(\b[a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)[^@\s/]+@/gi,
      "$1[redacted]@"
    )
    .replace(
      /\b(authorization|proxy-authorization)\s*:\s*(?:basic|bearer)\s+[^\s,;]+/gi,
      "$1: [redacted]"
    )
    .replace(
      /\b(bearer\s+)[a-z0-9._~+/-]+=*/gi,
      "$1[redacted]"
    )
    .replace(
      /\b((?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|secret|password)\s*[:=]\s*)[^\s,;]+/gi,
      "$1[redacted]"
    )
    .slice(0, 500);
}

function failure(input: {
  code: string;
  message: string;
  retryable: boolean;
  attempt: number;
}): Prisma.InputJsonValue {
  return {
    code: input.code.slice(0, 160),
    message: sanitizeFailureMessage(input.message),
    retryable: input.retryable,
    attempt: input.attempt,
  };
}

export class AgentExecutionRunner {
  private readonly store: RunnerStore;
  private readonly handler: AgentExecutionHandler;
  private readonly retryPolicy: AgentExecutionRetryPolicy;
  private readonly now: () => Date;
  private readonly hooks: AgentExecutionRunnerHooks;

  constructor(input: {
    store: RunnerStore;
    handler: AgentExecutionHandler;
    retryPolicy: AgentExecutionRetryPolicy;
    now?: () => Date;
    hooks?: AgentExecutionRunnerHooks;
  }) {
    this.store = input.store;
    this.handler = input.handler;
    this.retryPolicy = input.retryPolicy;
    this.now = input.now ?? (() => new Date());
    this.hooks = input.hooks ?? {};
  }

  async run(input: {
    execution: AgentExecutionRecord;
    workerId: string;
    signal: AbortSignal;
  }): Promise<AgentExecutionRunnerResult> {
    const startedAt = this.now();
    if (
      input.execution.status !== "running" ||
      input.execution.leaseOwner !== input.workerId ||
      !input.execution.leaseExpiresAt ||
      input.execution.leaseExpiresAt <= startedAt ||
      input.signal.aborted
    ) {
      return { state: "lease_lost" };
    }

    const context: AgentExecutionHandlerContext = {
      execution: input.execution,
      signal: input.signal,
      saveCheckpoint: async (checkpoint) => {
        if (input.signal.aborted) throw new LeaseLostDuringRun();
        const saved = await this.store.saveCheckpoint({
          executionId: input.execution.id,
          workerId: input.workerId,
          checkpoint,
          now: this.now(),
        });
        if (!saved) throw new LeaseLostDuringRun();
      },
      appendEvent: async (event) => {
        if (input.signal.aborted) throw new LeaseLostDuringRun();
        try {
          await this.store.appendEvent({
            executionId: input.execution.id,
            workerId: input.workerId,
            key: event.key,
            type: event.type,
            payload: event.payload,
            now: this.now(),
          });
        } catch (error) {
          if (
            error instanceof AgentExecutionStoreError &&
            error.code === "execution_lease_lost"
          ) {
            throw new LeaseLostDuringRun();
          }
          throw error;
        }
      },
    };

    let result: AgentExecutionHandlerResult;
    try {
      await this.hooks.beforeHandler?.(input.execution);
      result = await this.handler(context);
      await this.hooks.afterHandler?.(result, input.execution);
    } catch (error) {
      if (error instanceof AgentExecutionFaultInjectionCrash) throw error;
      if (error instanceof LeaseLostDuringRun || input.signal.aborted) {
        return { state: "lease_lost" };
      }
      // 确定性客户端错误(参数/鉴权/欠费/上下文超长等)不会在重试窗口内自愈,
      // 一律 fail-fast 避免把全量 prompt 重发数倍;仅 429 与 5xx/网络错误可重试。
      const deterministicClientError =
        error instanceof AgentRuntimeError &&
        error.status < 500 &&
        error.status !== 429;
      result = {
        kind: "failed",
        code: "execution_error",
        message: error instanceof Error ? error.message : "Execution failed",
        retryable: !deterministicClientError,
      };
    }

    if (input.signal.aborted) return { state: "lease_lost" };
    await this.hooks.beforeTransition?.(result, input.execution);
    const now = this.now();

    if (result.kind === "completed") {
      const completed = await this.store.markCompleted({
        executionId: input.execution.id,
        workerId: input.workerId,
        now,
        ...(result.checkpoint ? { checkpoint: result.checkpoint } : {}),
      });
      return completed ? { state: "completed" } : { state: "lease_lost" };
    }

    if (result.kind === "waiting_approval") {
      const waiting = await this.store.markWaitingForApproval({
        executionId: input.execution.id,
        workerId: input.workerId,
        toolExecutionId: result.toolExecutionId,
        checkpoint: result.checkpoint,
        now,
      });
      return waiting
        ? { state: "waiting_approval" }
        : { state: "lease_lost" };
    }

    if (result.kind === "cancelled") {
      const cancelled = await this.store.markCancelled({
        executionId: input.execution.id,
        workerId: input.workerId,
        failure: failure({
          code: result.code ?? "execution_cancelled",
          message: result.message ?? "Execution cancelled",
          retryable: false,
          attempt: input.execution.attempt,
        }),
        now,
        ...(result.checkpoint ? { checkpoint: result.checkpoint } : {}),
      });
      return cancelled ? { state: "cancelled" } : { state: "lease_lost" };
    }

    const retryDecision = result.retryable
      ? this.retryPolicy.decide({
          attempt: input.execution.attempt,
          now,
        })
      : ({ action: "fail" } as const);

    if (retryDecision.action === "retry") {
      const retryFailure = failure({
        code: result.code,
        message: result.message,
        retryable: true,
        attempt: input.execution.attempt,
      });
      const scheduled = await this.store.scheduleRetry({
        executionId: input.execution.id,
        workerId: input.workerId,
        failure: retryFailure,
        scheduledAt: retryDecision.scheduledAt,
        now,
        ...(result.checkpoint ? { checkpoint: result.checkpoint } : {}),
      });
      return scheduled
        ? {
            state: "retry_scheduled",
            scheduledAt: retryDecision.scheduledAt,
          }
        : { state: "lease_lost" };
    }

    const failed = await this.store.markFailed({
      executionId: input.execution.id,
      workerId: input.workerId,
      failure: failure({
        code: result.code,
        message: result.message,
        retryable: false,
        attempt: input.execution.attempt,
      }),
      now,
      ...(result.checkpoint ? { checkpoint: result.checkpoint } : {}),
    });
    return failed ? { state: "failed" } : { state: "lease_lost" };
  }
}
