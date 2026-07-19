import { Prisma, type AgentExecution, type AgentExecutionEvent } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import type {
  AgentExecutionEventRecord,
  AgentExecutionRecord,
  AgentExecutionStore,
  AgentCheckpoint,
} from "./agent-execution-store";
import { parseAgentCheckpoint } from "./agent-execution-store";

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

export class PrismaAgentExecutionStore implements AgentExecutionStore {
  async create(input: {
    userId: string;
    conversationId: string;
    projectId?: string | null;
    checkpoint: AgentCheckpoint;
    scheduledAt?: Date;
  }) {
    const scheduledAt = input.scheduledAt ?? new Date();
    const checkpoint = parseAgentCheckpoint(input.checkpoint);
    const created = await prisma.$transaction(async (transaction) => {
      const conversation = await transaction.conversation.findFirst({
        where: { id: input.conversationId, userId: input.userId },
        select: { id: true, projectId: true },
      });
      if (!conversation) {
        throw new Error("Agent execution conversation is not owned by the user");
      }
      if (input.projectId) {
        if (conversation.projectId !== input.projectId) {
          throw new Error("Agent execution project does not match the conversation");
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
    const candidate = await prisma.agentExecution.findFirst({
      where: {
        status: "queued",
        scheduledAt: { lte: input.now },
      },
      orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
    });
    if (!candidate) return null;

    const leaseExpiresAt = new Date(input.now.getTime() + input.leaseMs);
    const claimed = await prisma.$transaction(async (transaction) => {
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
          payload: { workerId: input.workerId, attempt: eventSequence.attempt },
          createdAt: input.now,
        },
      });
      return eventSequence;
    });
    if (!claimed) return null;

    return {
      ...toExecutionRecord(candidate),
      status: "running",
      leaseOwner: input.workerId,
      leaseExpiresAt,
      attempt: claimed.attempt,
      lastEventSequence: claimed.lastEventSequence,
    };
  }

  async recoverExpired(input: { now: Date }) {
    const candidates = await prisma.agentExecution.findMany({
      where: {
        status: "running",
        leaseExpiresAt: { lt: input.now },
      },
      select: { id: true, attempt: true },
    });
    let recovered = 0;

    for (const candidate of candidates) {
      const didRecover = await prisma.$transaction(async (transaction) => {
        const updated = await transaction.agentExecution.updateMany({
          where: {
            id: candidate.id,
            status: "running",
            leaseExpiresAt: { lt: input.now },
          },
          data: {
            status: "queued",
            leaseOwner: null,
            leaseExpiresAt: null,
            scheduledAt: input.now,
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
            key: `lease_expired:${candidate.attempt}`,
            type: "lease_expired",
            payload: { attempt: candidate.attempt },
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
    const renewed = await prisma.agentExecution.updateMany({
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

  async markWaitingForApproval(input: {
    executionId: string;
    workerId: string;
    toolExecutionId: string;
    checkpoint: AgentCheckpoint;
    now: Date;
  }) {
    const checkpoint = parseAgentCheckpoint(input.checkpoint);
    return prisma.$transaction(async (transaction) => {
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
    return prisma.$transaction(async (transaction) => {
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
          userId: execution.userId,
          conversationId: execution.conversationId,
          status: {
            in: ["succeeded", "failed", "blocked", "rejected", "expired", "cancelled"],
          },
        },
        select: { id: true, status: true },
      });
      if (!resolvedTool) return false;

      const lockedResolvedTool = await transaction.toolExecution.updateMany({
        where: {
          id: resolvedTool.id,
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

  async appendEvent(input: {
    executionId: string;
    key: string;
    type: string;
    payload?: Prisma.InputJsonValue;
    now?: Date;
  }) {
    let created: AgentExecutionEvent;
    try {
      created = await prisma.$transaction(async (transaction) => {
        const existing = await transaction.agentExecutionEvent.findUnique({
          where: {
            executionId_key: {
              executionId: input.executionId,
              key: input.key,
            },
          },
        });
        if (existing) return existing;

        const execution = await transaction.agentExecution.update({
          where: { id: input.executionId },
          data: { lastEventSequence: { increment: 1 } },
          select: { lastEventSequence: true },
        });
        return transaction.agentExecutionEvent.create({
          data: {
            executionId: input.executionId,
            sequence: execution.lastEventSequence,
            key: input.key,
            type: input.type,
            payload: input.payload ?? Prisma.JsonNull,
            ...(input.now ? { createdAt: input.now } : {}),
          },
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const existing = await prisma.agentExecutionEvent.findUnique({
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
