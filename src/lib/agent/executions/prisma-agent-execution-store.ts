import {
  Prisma,
  type AgentExecution,
  type AgentExecutionEvent,
  type PrismaClient,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import type {
  CreateOrGetAgentExecutionInput,
  CreateOrGetAgentExecutionResult,
  AgentExecutionEventRecord,
  AgentExecutionRecord,
  AgentExecutionStore,
  AgentCheckpoint,
} from "./agent-execution-store";
import {
  AgentExecutionStoreError,
  parseAgentCheckpoint,
} from "./agent-execution-store";

function toExecutionRecord(row: AgentExecution): AgentExecutionRecord {
  return {
    ...row,
    checkpoint: row.checkpoint ? parseAgentCheckpoint(row.checkpoint) : null,
  };
}

function toEventRecord(row: AgentExecutionEvent): AgentExecutionEventRecord {
  return row;
}

function assertPositiveLeaseMs(leaseMs: number) {
  if (!Number.isFinite(leaseMs) || leaseMs <= 0) {
    throw new Error("leaseMs must be a positive finite number");
  }
}

function failureCode(failure: Prisma.InputJsonValue | undefined): string | null {
  if (
    failure &&
    !Array.isArray(failure) &&
    typeof failure === "object" &&
    "code" in failure &&
    typeof failure.code === "string"
  ) {
    return failure.code;
  }
  return null;
}

function isKnownPrismaError(
  error: unknown,
  code: string
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === code
  );
}

export class PrismaAgentExecutionStore implements AgentExecutionStore {
  constructor(private readonly client: PrismaClient = prisma) {}

  async createOrGetByClientRunKey(
    input: CreateOrGetAgentExecutionInput
  ): Promise<CreateOrGetAgentExecutionResult> {
    const clientRunKey = input.clientRunKey.trim();
    const requestHash = input.requestHash.trim();
    if (!clientRunKey) {
      throw new Error("clientRunKey must not be empty");
    }
    if (!requestHash) {
      throw new Error("requestHash must not be empty");
    }

    const scheduledAt = input.scheduledAt ?? new Date();
    const checkpoint = parseAgentCheckpoint(input.checkpoint);

    const executeTransaction = () =>
      this.client.$transaction(
        async (transaction) => {
          const existing = await transaction.agentExecution.findUnique({
            where: {
              userId_clientRunKey: {
                userId: input.userId,
                clientRunKey,
              },
            },
          });
          if (existing) {
            return this.matchIdempotentExecution(existing, requestHash);
          }

          let conversation: { id: string; projectId: string | null };
          if (input.conversation.id) {
            const ownedConversation =
              await transaction.conversation.findFirst({
                where: {
                  id: input.conversation.id,
                  userId: input.userId,
                },
                select: { id: true, projectId: true },
              });
            if (!ownedConversation) {
              throw new Error(
                "Agent execution conversation is not owned by the user"
              );
            }
            if (
              input.conversation.projectId !== undefined &&
              ownedConversation.projectId !== input.conversation.projectId
            ) {
              throw new Error(
                "Agent execution project does not match the conversation"
              );
            }
            conversation = ownedConversation;
          } else {
            if (input.conversation.projectId) {
              const project = await transaction.project.findFirst({
                where: {
                  id: input.conversation.projectId,
                  userId: input.userId,
                },
                select: { id: true },
              });
              if (!project) {
                throw new Error(
                  "Agent execution project is not owned by the user"
                );
              }
            }
            conversation = await transaction.conversation.create({
              data: {
                userId: input.userId,
                projectId: input.conversation.projectId ?? null,
                title: input.conversation.title,
                model: input.conversation.model,
                thinkingEnabled: input.conversation.thinkingEnabled,
              },
              select: { id: true, projectId: true },
            });
          }

          const userMessage = await transaction.message.create({
            data: {
              conversationId: conversation.id,
              role: "user",
              content: input.userMessageContent,
            },
            select: { id: true },
          });
          const assistantMessage = await transaction.message.create({
            data: {
              conversationId: conversation.id,
              role: "assistant",
              content: "",
              ...(input.assistantMessageSources === undefined
                ? {}
                : { sources: input.assistantMessageSources }),
            },
            select: { id: true },
          });
          const execution = await transaction.agentExecution.create({
            data: {
              userId: input.userId,
              clientRunKey,
              requestHash,
              userMessageId: userMessage.id,
              assistantMessageId: assistantMessage.id,
              conversationId: conversation.id,
              projectId: conversation.projectId,
              checkpoint: checkpoint as unknown as Prisma.InputJsonValue,
              scheduledAt,
              lastEventSequence: 1,
            },
          });
          await transaction.agentExecutionEvent.create({
            data: {
              executionId: execution.id,
              sequence: 1,
              key: "run_queued",
              type: "run_queued",
              payload: { scheduledAt: scheduledAt.toISOString() },
              createdAt: scheduledAt,
            },
          });
          return {
            execution: toExecutionRecord(execution),
            created: true,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );

    let lastSerializationError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await executeTransaction();
      } catch (error) {
        if (isKnownPrismaError(error, "P2002")) {
          return this.resolveDispatchUniqueConflict({
            userId: input.userId,
            clientRunKey,
            requestHash,
          });
        }
        if (isKnownPrismaError(error, "P2034")) {
          lastSerializationError = error;
          continue;
        }
        throw error;
      }
    }

    const existing = await this.findByClientRunKey({
      userId: input.userId,
      clientRunKey,
    });
    if (existing) {
      return this.matchIdempotentExecution(existing, requestHash);
    }
    throw lastSerializationError;
  }
  private findByClientRunKey(input: {
    userId: string;
    clientRunKey: string;
  }) {
    return this.client.agentExecution.findUnique({
      where: {
        userId_clientRunKey: input,
      },
    });
  }

  private matchIdempotentExecution(
    existing: AgentExecution,
    requestHash: string
  ): CreateOrGetAgentExecutionResult {
    if (existing.requestHash !== requestHash) {
      throw new AgentExecutionStoreError(
        "idempotency_key_reused",
        "The client run key is already bound to a different request"
      );
    }
    return {
      execution: toExecutionRecord(existing),
      created: false,
    };
  }

  private async resolveDispatchUniqueConflict(input: {
    userId: string;
    clientRunKey: string;
    requestHash: string;
  }): Promise<CreateOrGetAgentExecutionResult> {
    const existing = await this.findByClientRunKey(input);
    if (existing) {
      return this.matchIdempotentExecution(existing, input.requestHash);
    }
    throw new AgentExecutionStoreError(
      "conversation_execution_in_progress",
      "The conversation already has a nonterminal execution"
    );
  }

  async getOwnedExecution(input: {
    executionId: string;
    userId: string;
  }): Promise<AgentExecutionRecord | null> {
    const execution = await this.client.agentExecution.findFirst({
      where: { id: input.executionId, userId: input.userId },
    });
    return execution ? toExecutionRecord(execution) : null;
  }

  async listEventsAfter(input: {
    executionId: string;
    userId: string;
    afterSequence: number;
    limit?: number;
  }): Promise<AgentExecutionEventRecord[] | null> {
    if (!Number.isInteger(input.afterSequence) || input.afterSequence < 0) {
      throw new Error("afterSequence must be a non-negative integer");
    }
    const limit = input.limit ?? 100;
    if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
      throw new Error("limit must be an integer between 1 and 500");
    }

    const owned = await this.client.agentExecution.findFirst({
      where: { id: input.executionId, userId: input.userId },
      select: { id: true },
    });
    if (!owned) return null;

    const events = await this.client.agentExecutionEvent.findMany({
      where: {
        executionId: input.executionId,
        sequence: { gt: input.afterSequence },
      },
      orderBy: { sequence: "asc" },
      take: limit,
    });
    return events.map(toEventRecord);
  }

  async create(input: {
    userId: string;
    conversationId: string;
    projectId?: string | null;
    checkpoint: AgentCheckpoint;
    scheduledAt?: Date;
  }) {
    const scheduledAt = input.scheduledAt ?? new Date();
    const checkpoint = parseAgentCheckpoint(input.checkpoint);
    const created = await this.client.$transaction(async (transaction) => {
      const conversation = await transaction.conversation.findFirst({
        where: { id: input.conversationId, userId: input.userId },
        select: { id: true, projectId: true },
      });
      if (!conversation) {
        throw new Error("Agent execution conversation is not owned by the user");
      }
      if (input.projectId) {
        if (conversation.projectId !== input.projectId) {
          throw new Error(
            "Agent execution project does not match the conversation"
          );
        }
        const project = await transaction.project.findFirst({
          where: { id: input.projectId, userId: input.userId },
          select: { id: true },
        });
        if (!project) {
          throw new Error("Agent execution project is not owned by the user");
        }
      }

      const execution = await transaction.agentExecution.create({
        data: {
          userId: input.userId,
          conversationId: input.conversationId,
          projectId: input.projectId ?? null,
          checkpoint: checkpoint as unknown as Prisma.InputJsonValue,
          scheduledAt,
          lastEventSequence: 1,
        },
      });
      await transaction.agentExecutionEvent.create({
        data: {
          executionId: execution.id,
          sequence: 1,
          key: "run_queued",
          type: "run_queued",
          payload: { scheduledAt: scheduledAt.toISOString() },
          createdAt: scheduledAt,
        },
      });
      return execution;
    });

    return toExecutionRecord(created);
  }

  async claimNext(input: {
    workerId: string;
    now: Date;
    leaseMs: number;
  }): Promise<AgentExecutionRecord | null> {
    assertPositiveLeaseMs(input.leaseMs);
    const leaseExpiresAt = new Date(input.now.getTime() + input.leaseMs);
    const lostCandidates: string[] = [];

    for (let scan = 0; scan < 32; scan += 1) {
      const candidate = await this.client.agentExecution.findFirst({
        where: {
          status: "queued",
          scheduledAt: { lte: input.now },
          ...(lostCandidates.length > 0
            ? { id: { notIn: lostCandidates } }
            : {}),
        },
        orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
      });
      if (!candidate) return null;

      const claimed = await this.client.$transaction(async (transaction) => {
        const updated = await transaction.agentExecution.updateMany({
          where: {
            id: candidate.id,
            status: "queued",
            scheduledAt: { lte: input.now },
          },
          data: {
            status: "running",
            leaseOwner: input.workerId,
            leaseExpiresAt,
            attempt: { increment: 1 },
          },
        });
        if (updated.count !== 1) return null;

        const eventSequence = await transaction.agentExecution.update({
          where: { id: candidate.id },
          data: { lastEventSequence: { increment: 1 } },
          select: { attempt: true, lastEventSequence: true },
        });
        await transaction.agentExecutionEvent.create({
          data: {
            executionId: candidate.id,
            sequence: eventSequence.lastEventSequence,
            key: `run_claimed:${eventSequence.attempt}`,
            type: "run_claimed",
            payload: {
              workerId: input.workerId,
              attempt: eventSequence.attempt,
            },
            createdAt: input.now,
          },
        });
        return eventSequence;
      });
      if (!claimed) {
        lostCandidates.push(candidate.id);
        continue;
      }

      return {
        ...toExecutionRecord(candidate),
        status: "running",
        leaseOwner: input.workerId,
        leaseExpiresAt,
        attempt: claimed.attempt,
        lastEventSequence: claimed.lastEventSequence,
      };
    }

    return null;
  }

  async recoverExpired(input: {
    now: Date;
    maxAttempts?: number;
    retryDelayMs?: (attempt: number) => number;
  }) {
    const maxAttempts = input.maxAttempts ?? 3;
    if (!Number.isInteger(maxAttempts) || maxAttempts <= 0) {
      throw new Error("maxAttempts must be a positive integer");
    }
    const candidates = await this.client.agentExecution.findMany({
      where: {
        status: "running",
        leaseExpiresAt: { lt: input.now },
      },
      select: { id: true, attempt: true },
    });
    let recovered = 0;

    for (const candidate of candidates) {
      const exhausted = candidate.attempt >= maxAttempts;
      const delayMs = exhausted
        ? 0
        : (input.retryDelayMs?.(candidate.attempt) ?? 0);
      if (!Number.isFinite(delayMs) || delayMs < 0) {
        throw new Error("retryDelayMs must return a non-negative finite number");
      }
      const scheduledAt = new Date(input.now.getTime() + delayMs);
      const didRecover = await this.client.$transaction(async (transaction) => {
        const updated = await transaction.agentExecution.updateMany({
          where: {
            id: candidate.id,
            status: "running",
            leaseExpiresAt: { lt: input.now },
          },
          data: exhausted
            ? {
                status: "failed",
                leaseOwner: null,
                leaseExpiresAt: null,
                failure: {
                  code: "max_attempts_exceeded",
                  message:
                    "Execution lease expired after the maximum number of attempts",
                  retryable: false,
                  attempt: candidate.attempt,
                },
              }
            : {
                status: "queued",
                leaseOwner: null,
                leaseExpiresAt: null,
                scheduledAt,
              },
        });
        if (updated.count !== 1) return false;

        const execution = await transaction.agentExecution.update({
          where: { id: candidate.id },
          data: { lastEventSequence: { increment: 1 } },
          select: { lastEventSequence: true },
        });
        await transaction.agentExecutionEvent.create({
          data: {
            executionId: candidate.id,
            sequence: execution.lastEventSequence,
            key: exhausted
              ? `lease_poisoned:${candidate.attempt}`
              : `lease_expired:${candidate.attempt}`,
            type: exhausted ? "run_failed" : "lease_expired",
            payload: exhausted
              ? {
                  failureCode: "max_attempts_exceeded",
                  attempt: candidate.attempt,
                }
              : {
                  attempt: candidate.attempt,
                  scheduledAt: scheduledAt.toISOString(),
                },
            createdAt: input.now,
          },
        });
        return true;
      });
      if (didRecover) recovered += 1;
    }

    return recovered;
  }

  async renewLease(input: {
    executionId: string;
    workerId: string;
    now: Date;
    leaseMs: number;
  }) {
    assertPositiveLeaseMs(input.leaseMs);
    const leaseExpiresAt = new Date(input.now.getTime() + input.leaseMs);
    const renewed = await this.client.agentExecution.updateMany({
      where: {
        id: input.executionId,
        status: "running",
        leaseOwner: input.workerId,
        leaseExpiresAt: { gt: input.now },
      },
      data: { leaseExpiresAt },
    });
    return renewed.count === 1;
  }

  async saveCheckpoint(input: {
    executionId: string;
    workerId: string;
    checkpoint: AgentCheckpoint;
    now: Date;
  }) {
    const checkpoint = parseAgentCheckpoint(input.checkpoint);
    const updated = await this.client.agentExecution.updateMany({
      where: {
        id: input.executionId,
        status: "running",
        leaseOwner: input.workerId,
        leaseExpiresAt: { gt: input.now },
      },
      data: {
        checkpoint: checkpoint as unknown as Prisma.InputJsonValue,
      },
    });
    return updated.count === 1;
  }

  async markCompleted(input: {
    executionId: string;
    workerId: string;
    now: Date;
    checkpoint?: AgentCheckpoint;
  }) {
    const checkpoint = input.checkpoint
      ? parseAgentCheckpoint(input.checkpoint)
      : undefined;
    return this.transitionRunningExecution({
      executionId: input.executionId,
      workerId: input.workerId,
      now: input.now,
      data: {
        status: "completed",
        leaseOwner: null,
        leaseExpiresAt: null,
        waitingToolExecutionId: null,
        failure: Prisma.JsonNull,
        ...(checkpoint
          ? {
              checkpoint:
                checkpoint as unknown as Prisma.InputJsonValue,
            }
          : {}),
      },
      event: () => ({
        key: "run_completed",
        type: "run_completed",
        payload: {},
      }),
    });
  }

  async markFailed(input: {
    executionId: string;
    workerId: string;
    failure: Prisma.InputJsonValue;
    now: Date;
    checkpoint?: AgentCheckpoint;
  }) {
    const checkpoint = input.checkpoint
      ? parseAgentCheckpoint(input.checkpoint)
      : undefined;
    return this.transitionRunningExecution({
      executionId: input.executionId,
      workerId: input.workerId,
      now: input.now,
      data: {
        status: "failed",
        leaseOwner: null,
        leaseExpiresAt: null,
        waitingToolExecutionId: null,
        failure: input.failure,
        ...(checkpoint
          ? {
              checkpoint:
                checkpoint as unknown as Prisma.InputJsonValue,
            }
          : {}),
      },
      event: () => ({
        key: "run_failed",
        type: "run_failed",
        payload: { failureCode: failureCode(input.failure) },
      }),
    });
  }

  async markCancelled(input: {
    executionId: string;
    workerId: string;
    failure?: Prisma.InputJsonValue;
    now: Date;
    checkpoint?: AgentCheckpoint;
  }) {
    const checkpoint = input.checkpoint
      ? parseAgentCheckpoint(input.checkpoint)
      : undefined;
    return this.transitionRunningExecution({
      executionId: input.executionId,
      workerId: input.workerId,
      now: input.now,
      data: {
        status: "cancelled",
        leaseOwner: null,
        leaseExpiresAt: null,
        waitingToolExecutionId: null,
        failure: input.failure ?? Prisma.JsonNull,
        ...(checkpoint
          ? {
              checkpoint:
                checkpoint as unknown as Prisma.InputJsonValue,
            }
          : {}),
      },
      event: () => ({
        key: "run_cancelled",
        type: "run_cancelled",
        payload: { failureCode: failureCode(input.failure) },
      }),
    });
  }

  async scheduleRetry(input: {
    executionId: string;
    workerId: string;
    failure: Prisma.InputJsonValue;
    scheduledAt: Date;
    now: Date;
    checkpoint?: AgentCheckpoint;
  }) {
    const checkpoint = input.checkpoint
      ? parseAgentCheckpoint(input.checkpoint)
      : undefined;
    return this.transitionRunningExecution({
      executionId: input.executionId,
      workerId: input.workerId,
      now: input.now,
      data: {
        status: "queued",
        scheduledAt: input.scheduledAt,
        leaseOwner: null,
        leaseExpiresAt: null,
        failure: input.failure,
        ...(checkpoint
          ? {
              checkpoint:
                checkpoint as unknown as Prisma.InputJsonValue,
            }
          : {}),
      },
      event: (execution) => ({
        key: `run_retry_scheduled:${execution.attempt}`,
        type: "run_retry_scheduled",
        payload: {
          attempt: execution.attempt,
          scheduledAt: input.scheduledAt.toISOString(),
          failureCode: failureCode(input.failure),
        },
      }),
    });
  }

  private async transitionRunningExecution(input: {
    executionId: string;
    workerId: string;
    now: Date;
    data: Prisma.AgentExecutionUpdateManyMutationInput;
    event: (execution: {
      attempt: number;
      lastEventSequence: number;
    }) => {
      key: string;
      type: string;
      payload: Prisma.InputJsonValue;
    };
  }): Promise<boolean> {
    return this.client.$transaction(async (transaction) => {
      const [execution] =
        await transaction.agentExecution.updateManyAndReturn({
          where: {
            id: input.executionId,
            status: "running",
            leaseOwner: input.workerId,
            leaseExpiresAt: { gt: input.now },
          },
          data: {
            ...input.data,
            lastEventSequence: { increment: 1 },
          },
          select: {
            id: true,
            attempt: true,
            lastEventSequence: true,
          },
        });
      if (!execution) return false;

      const event = input.event(execution);
      await transaction.agentExecutionEvent.create({
        data: {
          executionId: input.executionId,
          sequence: execution.lastEventSequence,
          key: event.key,
          type: event.type,
          payload: event.payload,
          createdAt: input.now,
        },
      });
      return true;
    });
  }

  async markWaitingForApproval(input: {
    executionId: string;
    workerId: string;
    toolExecutionId: string;
    checkpoint: AgentCheckpoint;
    now: Date;
  }) {
    const checkpoint = parseAgentCheckpoint(input.checkpoint);
    return this.client.$transaction(async (transaction) => {
      const execution = await transaction.agentExecution.findFirst({
        where: {
          id: input.executionId,
          status: "running",
          leaseOwner: input.workerId,
          leaseExpiresAt: { gt: input.now },
        },
        select: { userId: true, conversationId: true },
      });
      if (!execution) return false;

      const lockedPendingTool = await transaction.toolExecution.updateMany({
        where: {
          id: input.toolExecutionId,
          agentExecutionId: input.executionId,
          userId: execution.userId,
          conversationId: execution.conversationId,
          status: "pending_approval",
          OR: [{ expiresAt: null }, { expiresAt: { gt: input.now } }],
        },
        data: { status: "pending_approval" },
      });
      if (lockedPendingTool.count !== 1) return false;

      const updated = await transaction.agentExecution.updateMany({
        where: {
          id: input.executionId,
          status: "running",
          leaseOwner: input.workerId,
          leaseExpiresAt: { gt: input.now },
        },
        data: {
          status: "waiting_approval",
          checkpoint: checkpoint as unknown as Prisma.InputJsonValue,
          waitingToolExecutionId: input.toolExecutionId,
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
      if (updated.count !== 1) return false;

      const eventSequence = await transaction.agentExecution.update({
        where: { id: input.executionId },
        data: { lastEventSequence: { increment: 1 } },
        select: { lastEventSequence: true },
      });
      await transaction.agentExecutionEvent.create({
        data: {
          executionId: input.executionId,
          sequence: eventSequence.lastEventSequence,
          key: `approval_requested:${input.toolExecutionId}`,
          type: "approval_requested",
          payload: { toolExecutionId: input.toolExecutionId },
          createdAt: input.now,
        },
      });
      return true;
    });
  }

  async enqueueAfterApproval(input: {
    executionId: string;
    toolExecutionId: string;
    now: Date;
  }) {
    return this.client.$transaction(async (transaction) => {
      const execution = await transaction.agentExecution.findFirst({
        where: {
          id: input.executionId,
          status: "waiting_approval",
          waitingToolExecutionId: input.toolExecutionId,
        },
        select: { userId: true, conversationId: true },
      });
      if (!execution) return false;

      const resolvedTool = await transaction.toolExecution.findFirst({
        where: {
          id: input.toolExecutionId,
          agentExecutionId: input.executionId,
          userId: execution.userId,
          conversationId: execution.conversationId,
          status: {
            in: [
              "approved",
              "succeeded",
              "failed",
              "blocked",
              "rejected",
              "expired",
              "cancelled",
            ],
          },
        },
        select: { id: true, status: true },
      });
      if (!resolvedTool) return false;

      const lockedResolvedTool = await transaction.toolExecution.updateMany({
        where: {
          id: resolvedTool.id,
          agentExecutionId: input.executionId,
          userId: execution.userId,
          conversationId: execution.conversationId,
          status: resolvedTool.status,
        },
        data: { status: resolvedTool.status },
      });
      if (lockedResolvedTool.count !== 1) return false;

      const updated = await transaction.agentExecution.updateMany({
        where: {
          id: input.executionId,
          status: "waiting_approval",
          waitingToolExecutionId: input.toolExecutionId,
        },
        data: {
          status: "queued",
          leaseOwner: null,
          leaseExpiresAt: null,
          scheduledAt: input.now,
        },
      });
      if (updated.count !== 1) return false;

      const eventSequence = await transaction.agentExecution.update({
        where: { id: input.executionId },
        data: { lastEventSequence: { increment: 1 } },
        select: { lastEventSequence: true },
      });
      await transaction.agentExecutionEvent.create({
        data: {
          executionId: input.executionId,
          sequence: eventSequence.lastEventSequence,
          key: `approval_resumed:${input.toolExecutionId}`,
          type: "approval_resumed",
          payload: { toolExecutionId: input.toolExecutionId },
          createdAt: input.now,
        },
      });
      return true;
    });
  }

  async expireWaitingApproval(input: {
    executionId: string;
    toolExecutionId: string;
    now: Date;
  }) {
    return this.client.$transaction(async (transaction) => {
      const execution = await transaction.agentExecution.findFirst({
        where: {
          id: input.executionId,
          status: "waiting_approval",
          waitingToolExecutionId: input.toolExecutionId,
        },
        select: { userId: true, conversationId: true },
      });
      if (!execution) return false;

      const expiredTool = await transaction.toolExecution.updateMany({
        where: {
          id: input.toolExecutionId,
          agentExecutionId: input.executionId,
          userId: execution.userId,
          conversationId: execution.conversationId,
          status: "pending_approval",
          expiresAt: { lte: input.now },
        },
        data: {
          status: "expired",
          completedAt: input.now,
          errorSummary: {
            code: "APPROVAL_EXPIRED",
            message: "Approval expired before the tool could run",
          },
        },
      });
      if (expiredTool.count !== 1) return false;

      const updated = await transaction.agentExecution.updateMany({
        where: {
          id: input.executionId,
          status: "waiting_approval",
          waitingToolExecutionId: input.toolExecutionId,
        },
        data: {
          status: "queued",
          scheduledAt: input.now,
        },
      });
      if (updated.count !== 1) return false;

      const eventSequence = await transaction.agentExecution.update({
        where: { id: input.executionId },
        data: { lastEventSequence: { increment: 1 } },
        select: { lastEventSequence: true },
      });
      await transaction.agentExecutionEvent.create({
        data: {
          executionId: input.executionId,
          sequence: eventSequence.lastEventSequence,
          key: `approval_expired:${input.toolExecutionId}`,
          type: "approval_expired",
          payload: { toolExecutionId: input.toolExecutionId },
          createdAt: input.now,
        },
      });
      return true;
    });
  }

  async appendEvent(input: {
    executionId: string;
    workerId: string;
    key: string;
    type: string;
    payload?: Prisma.InputJsonValue;
    now: Date;
  }) {
    let created: AgentExecutionEvent;
    try {
      created = await this.client.$transaction(async (transaction) => {
        const lease = await transaction.agentExecution.findFirst({
          where: {
            id: input.executionId,
            status: "running",
            leaseOwner: input.workerId,
            leaseExpiresAt: { gt: input.now },
          },
          select: { id: true },
        });
        if (!lease) {
          throw new AgentExecutionStoreError(
            "execution_lease_lost",
            "The worker no longer owns an active execution lease"
          );
        }

        const existing = await transaction.agentExecutionEvent.findUnique({
          where: {
            executionId_key: {
              executionId: input.executionId,
              key: input.key,
            },
          },
        });
        if (existing) return existing;

        const [execution] =
          await transaction.agentExecution.updateManyAndReturn({
          where: {
            id: input.executionId,
            status: "running",
            leaseOwner: input.workerId,
            leaseExpiresAt: { gt: input.now },
          },
          data: { lastEventSequence: { increment: 1 } },
          select: { lastEventSequence: true },
        });
        if (!execution) {
          throw new AgentExecutionStoreError(
            "execution_lease_lost",
            "The worker no longer owns an active execution lease"
          );
        }
        return transaction.agentExecutionEvent.create({
          data: {
            executionId: input.executionId,
            sequence: execution.lastEventSequence,
            key: input.key,
            type: input.type,
            payload: input.payload ?? Prisma.JsonNull,
            createdAt: input.now,
          },
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const lease = await this.client.agentExecution.findFirst({
          where: {
            id: input.executionId,
            status: "running",
            leaseOwner: input.workerId,
            leaseExpiresAt: { gt: input.now },
          },
          select: { id: true },
        });
        if (!lease) {
          throw new AgentExecutionStoreError(
            "execution_lease_lost",
            "The worker no longer owns an active execution lease"
          );
        }
        const existing = await this.client.agentExecutionEvent.findUnique({
          where: {
            executionId_key: {
              executionId: input.executionId,
              key: input.key,
            },
          },
        });
        if (existing) return toEventRecord(existing);
      }
      throw error;
    }

    return toEventRecord(created);
  }
}
