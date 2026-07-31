import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AgentCheckpoint } from "./agent-execution-store";
import { PrismaAgentExecutionStore } from "./prisma-agent-execution-store";

const poolA = new Pool({ connectionString: process.env.DATABASE_URL });
const poolB = new Pool({ connectionString: process.env.DATABASE_URL });
const prismaA = new PrismaClient({ adapter: new PrismaPg(poolA) });
const prismaB = new PrismaClient({ adapter: new PrismaPg(poolB) });

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

async function fixture() {
  const suffix = randomUUID();
  const user = await prismaA.user.create({
    data: {
      email: `durable-store-${suffix}@example.test`,
      passwordHash: "integration-only",
    },
  });
  const conversation = await prismaA.conversation.create({
    data: {
      userId: user.id,
      title: "Durable store integration fixture",
    },
  });
  return { user, conversation };
}

describe("PrismaAgentExecutionStore PostgreSQL concurrency", () => {
  beforeAll(async () => {
    await Promise.all([prismaA.$queryRaw`SELECT 1`, prismaB.$queryRaw`SELECT 1`]);
  });

  afterAll(async () => {
    await Promise.all([prismaA.$disconnect(), prismaB.$disconnect()]);
    await Promise.all([poolA.end(), poolB.end()]);
  });

  it("creates one run and one message pair for concurrent idempotent dispatch", async () => {
    const { user, conversation } = await fixture();
    try {
      const input = {
        userId: user.id,
        clientRunKey: `client-${randomUUID()}`,
        requestHash: "sha256:integration-request",
        conversation: {
          id: conversation.id,
          title: "Existing",
          model: "deepseek-v4-pro",
          thinkingEnabled: true,
        },
        userMessageContent: "Explain Kirchhoff's law",
        checkpoint: checkpoint(),
        scheduledAt: new Date("2026-07-31T00:00:00.000Z"),
      };
      const [left, right] = await Promise.all([
        new PrismaAgentExecutionStore(prismaA).createOrGetByClientRunKey(
          input
        ),
        new PrismaAgentExecutionStore(prismaB).createOrGetByClientRunKey(
          input
        ),
      ]);

      expect(left.execution.id).toBe(right.execution.id);
      expect([left.created, right.created].sort()).toEqual([false, true]);
      await expect(
        prismaA.agentExecution.count({
          where: { userId: user.id, clientRunKey: input.clientRunKey },
        })
      ).resolves.toBe(1);
      await expect(
        prismaA.message.count({
          where: {
            conversationId: conversation.id,
            role: { in: ["user", "assistant"] },
          },
        })
      ).resolves.toBe(2);
      await expect(
        prismaA.agentExecutionEvent.count({
          where: { executionId: left.execution.id },
        })
      ).resolves.toBe(1);
    } finally {
      await prismaA.user.delete({ where: { id: user.id } });
    }
  });

  it("allows only the current lease owner to append after recovery", async () => {
    const { user, conversation } = await fixture();
    try {
      const storeA = new PrismaAgentExecutionStore(prismaA);
      const storeB = new PrismaAgentExecutionStore(prismaB);
      await storeA.createOrGetByClientRunKey({
        userId: user.id,
        clientRunKey: `client-${randomUUID()}`,
        requestHash: "sha256:lease-recovery",
        conversation: {
          id: conversation.id,
          title: "Existing",
          model: "deepseek-v4-pro",
          thinkingEnabled: true,
        },
        userMessageContent: "Recover this run",
        checkpoint: checkpoint(),
        scheduledAt: new Date("2026-07-31T00:00:00.000Z"),
      });
      const claimedA = await storeA.claimNext({
        workerId: "worker-a",
        now: new Date("2026-07-31T00:00:01.000Z"),
        leaseMs: 1_000,
      });
      expect(claimedA).not.toBeNull();

      await storeB.recoverExpired({
        now: new Date("2026-07-31T00:00:03.000Z"),
        maxAttempts: 3,
      });
      const claimedB = await storeB.claimNext({
        workerId: "worker-b",
        now: new Date("2026-07-31T00:00:03.000Z"),
        leaseMs: 30_000,
      });
      expect(claimedB?.id).toBe(claimedA?.id);

      await expect(
        storeA.appendEvent({
          executionId: claimedA!.id,
          workerId: "worker-a",
          key: "stale:event",
          type: "assistant_delta",
          payload: { text: "must not persist" },
          now: new Date("2026-07-31T00:00:04.000Z"),
        })
      ).rejects.toMatchObject({ code: "execution_lease_lost" });
      await expect(
        prismaA.agentExecutionEvent.findUnique({
          where: {
            executionId_key: {
              executionId: claimedA!.id,
              key: "stale:event",
            },
          },
        })
      ).resolves.toBeNull();
    } finally {
      await prismaA.user.delete({ where: { id: user.id } });
    }
  });

  it("lets two database clients claim one queued execution only once", async () => {
    const { user, conversation } = await fixture();
    try {
      const storeA = new PrismaAgentExecutionStore(prismaA);
      const storeB = new PrismaAgentExecutionStore(prismaB);
      const dispatched = await storeA.createOrGetByClientRunKey({
        userId: user.id,
        clientRunKey: `client-${randomUUID()}`,
        requestHash: "sha256:claim-race",
        conversation: {
          id: conversation.id,
          title: "Existing",
          model: "deepseek-v4-pro",
          thinkingEnabled: true,
        },
        userMessageContent: "Claim me once",
        checkpoint: checkpoint(),
        scheduledAt: new Date("2026-07-31T00:00:00.000Z"),
      });

      const claims = await Promise.all([
        storeA.claimNext({
          workerId: "worker-a",
          now: new Date("2026-07-31T00:00:01.000Z"),
          leaseMs: 30_000,
        }),
        storeB.claimNext({
          workerId: "worker-b",
          now: new Date("2026-07-31T00:00:01.000Z"),
          leaseMs: 30_000,
        }),
      ]);

      expect(claims.filter(Boolean)).toHaveLength(1);
      expect(claims.find(Boolean)?.id).toBe(dispatched.execution.id);
      await expect(
        prismaA.agentExecution.findUniqueOrThrow({
          where: { id: dispatched.execution.id },
          select: { status: true, attempt: true, leaseOwner: true },
        })
      ).resolves.toMatchObject({
        status: "running",
        attempt: 1,
        leaseOwner: expect.stringMatching(/^worker-[ab]$/),
      });
    } finally {
      await prismaA.user.delete({ where: { id: user.id } });
    }
  });

  it("cancels an owned queued run without deleting its stable message pair", async () => {
    const { user, conversation } = await fixture();
    try {
      const store = new PrismaAgentExecutionStore(prismaA);
      const dispatched = await store.createOrGetByClientRunKey({
        userId: user.id,
        clientRunKey: `client-${randomUUID()}`,
        requestHash: "sha256:cancel-owned",
        conversation: {
          id: conversation.id,
          title: "Existing",
          model: "deepseek-v4-pro",
          thinkingEnabled: true,
        },
        userMessageContent: "Cancel this run",
        checkpoint: checkpoint(),
      });

      await expect(
        store.cancelOwned({
          executionId: dispatched.execution.id,
          userId: user.id,
          now: new Date("2026-07-31T00:00:05.000Z"),
        })
      ).resolves.toBe(true);
      await expect(
        prismaA.agentExecution.findUniqueOrThrow({
          where: { id: dispatched.execution.id },
          select: { status: true, lastEventSequence: true },
        })
      ).resolves.toEqual({ status: "cancelled", lastEventSequence: 2 });
      await expect(
        prismaA.message.count({
          where: {
            id: {
              in: [
                dispatched.execution.userMessageId!,
                dispatched.execution.assistantMessageId!,
              ],
            },
          },
        })
      ).resolves.toBe(2);
    } finally {
      await prismaA.user.delete({ where: { id: user.id } });
    }
  });

  it("requeues an owned terminal run with a new durable sequence", async () => {
    const { user, conversation } = await fixture();
    try {
      const store = new PrismaAgentExecutionStore(prismaA);
      const dispatched = await store.createOrGetByClientRunKey({
        userId: user.id,
        clientRunKey: `client-${randomUUID()}`,
        requestHash: "sha256:user-retry",
        conversation: {
          id: conversation.id,
          title: "Existing",
          model: "deepseek-v4-pro",
          thinkingEnabled: true,
        },
        userMessageContent: "Retry this run",
        checkpoint: checkpoint(),
      });
      await prismaA.agentExecution.update({
        where: { id: dispatched.execution.id },
        data: {
          status: "failed",
          failure: {
            code: "provider_error",
            message: "temporary",
            retryable: true,
          },
        },
      });

      await expect(
        store.retryOwned({
          executionId: dispatched.execution.id,
          userId: user.id,
          now: new Date("2026-07-31T00:00:05.000Z"),
        })
      ).resolves.toBe(true);
      await expect(
        prismaA.agentExecution.findUniqueOrThrow({
          where: { id: dispatched.execution.id },
          select: { status: true, failure: true, lastEventSequence: true },
        })
      ).resolves.toEqual({
        status: "queued",
        failure: null,
        lastEventSequence: 2,
      });
    } finally {
      await prismaA.user.delete({ where: { id: user.id } });
    }
  });

  it("expires a waiting approval and automatically puts its run back in the queue", async () => {
    const { user, conversation } = await fixture();
    try {
      const store = new PrismaAgentExecutionStore(prismaA);
      const dispatched = await store.createOrGetByClientRunKey({
        userId: user.id,
        clientRunKey: `client-${randomUUID()}`,
        requestHash: "sha256:approval-expiry",
        conversation: {
          id: conversation.id,
          title: "Existing",
          model: "deepseek-v4-pro",
          thinkingEnabled: true,
        },
        userMessageContent: "Wait for approval",
        checkpoint: checkpoint(),
        scheduledAt: new Date("2026-07-31T00:00:00.000Z"),
      });
      const claimed = await store.claimNext({
        workerId: "worker-expiry",
        now: new Date("2026-07-31T00:00:01.000Z"),
        leaseMs: 30_000,
      });
      const tool = await prismaA.toolExecution.create({
        data: {
          agentExecutionId: dispatched.execution.id,
          providerToolCallId: "provider-tool-expiry",
          conversationId: conversation.id,
          userId: user.id,
          toolId: "artifact.save",
          normalizedArguments: {},
          argumentsHash: "sha256:arguments",
          riskLevel: "L2",
          status: "pending_approval",
          expiresAt: new Date("2026-07-31T00:00:02.000Z"),
        },
      });
      await expect(
        store.markWaitingForApproval({
          executionId: dispatched.execution.id,
          workerId: "worker-expiry",
          toolExecutionId: tool.id,
          checkpoint: checkpoint(),
          now: new Date("2026-07-31T00:00:01.500Z"),
        })
      ).resolves.toBe(true);

      await expect(
        store.reconcileWaitingApprovals({
          now: new Date("2026-07-31T00:00:03.000Z"),
        })
      ).resolves.toBe(1);
      await expect(
        prismaA.agentExecution.findUniqueOrThrow({
          where: { id: dispatched.execution.id },
          select: { status: true },
        })
      ).resolves.toEqual({ status: "queued" });
      await expect(
        prismaA.toolExecution.findUniqueOrThrow({
          where: { id: tool.id },
          select: { status: true },
        })
      ).resolves.toEqual({ status: "expired" });
      expect(claimed?.id).toBe(dispatched.execution.id);
    } finally {
      await prismaA.user.delete({ where: { id: user.id } });
    }
  });

  it("does not blindly retry a stale approved tool with an unknown outcome", async () => {
    const { user, conversation } = await fixture();
    try {
      const store = new PrismaAgentExecutionStore(prismaA);
      const dispatched = await store.createOrGetByClientRunKey({
        userId: user.id,
        clientRunKey: `client-${randomUUID()}`,
        requestHash: "sha256:approval-unknown-outcome",
        conversation: {
          id: conversation.id,
          title: "Existing",
          model: "deepseek-v4-pro",
          thinkingEnabled: true,
        },
        userMessageContent: "Run an approved side effect",
        checkpoint: checkpoint(),
        scheduledAt: new Date("2026-07-31T00:00:00.000Z"),
      });
      await store.claimNext({
        workerId: "worker-unknown-outcome",
        now: new Date("2026-07-31T00:00:01.000Z"),
        leaseMs: 30_000,
      });
      const tool = await prismaA.toolExecution.create({
        data: {
          agentExecutionId: dispatched.execution.id,
          providerToolCallId: "provider-tool-unknown-outcome",
          conversationId: conversation.id,
          userId: user.id,
          toolId: "artifact.save",
          normalizedArguments: {},
          argumentsHash: "sha256:unknown-outcome-arguments",
          riskLevel: "L2",
          status: "pending_approval",
          expiresAt: new Date("2026-07-31T00:10:00.000Z"),
        },
      });
      await expect(
        store.markWaitingForApproval({
          executionId: dispatched.execution.id,
          workerId: "worker-unknown-outcome",
          toolExecutionId: tool.id,
          checkpoint: checkpoint(),
          now: new Date("2026-07-31T00:00:01.500Z"),
        })
      ).resolves.toBe(true);
      await prismaA.toolExecution.update({
        where: { id: tool.id },
        data: {
          status: "executing",
          executedAt: new Date("2026-07-31T00:00:02.000Z"),
        },
      });

      await expect(
        store.reconcileWaitingApprovals({
          now: new Date("2026-07-31T00:06:00.000Z"),
        })
      ).resolves.toBe(1);
      await expect(
        prismaA.agentExecution.findUniqueOrThrow({
          where: { id: dispatched.execution.id },
          select: { status: true },
        })
      ).resolves.toEqual({ status: "queued" });
      await expect(
        prismaA.toolExecution.findUniqueOrThrow({
          where: { id: tool.id },
          select: { status: true, errorSummary: true },
        })
      ).resolves.toEqual({
        status: "failed",
        errorSummary: {
          code: "TOOL_EXECUTION_OUTCOME_UNKNOWN",
          message:
            "Approved tool execution did not report a terminal result; its side effect was not retried",
        },
      });
    } finally {
      await prismaA.user.delete({ where: { id: user.id } });
    }
  });
});
