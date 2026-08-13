import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";

const mocks = vi.hoisted(() => ({
  findConversation: vi.fn(),
  findProject: vi.fn(),
  findToolExecution: vi.fn(),
  updateToolExecution: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
  findEvents: vi.fn(),
  findExecutionUnique: vi.fn(),
  updateMany: vi.fn(),
  updateManyAndReturn: vi.fn(),
  update: vi.fn(),
  createConversation: vi.fn(),
  createMessage: vi.fn(),
  createExecution: vi.fn(),
  createEvent: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    conversation: { findFirst: mocks.findConversation },
    project: { findFirst: mocks.findProject },
    toolExecution: {
      findFirst: mocks.findToolExecution,
      updateMany: mocks.updateToolExecution,
    },
    agentExecution: {
      findFirst: mocks.findFirst,
      findUnique: mocks.findExecutionUnique,
      findMany: mocks.findMany,
      updateMany: mocks.updateMany,
      update: mocks.update,
    },
    agentExecutionEvent: {
      create: mocks.createEvent,
      findUnique: mocks.findUnique,
      findMany: mocks.findEvents,
    },
    $transaction: mocks.transaction,
  },
}));

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

import { PrismaAgentExecutionStore } from "./prisma-agent-execution-store";
import {
  parseAgentCheckpoint,
  type AgentCheckpoint,
} from "./agent-execution-store";

describe("PrismaAgentExecutionStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a queued execution with its first durable event", async () => {
    const now = new Date("2026-07-19T12:00:00.000Z");
    mocks.transaction.mockImplementation(async (operation) =>
      operation({
        conversation: { findFirst: mocks.findConversation },
        project: { findFirst: mocks.findProject },
        agentExecution: { create: mocks.createExecution },
        agentExecutionEvent: {
          create: mocks.createEvent,
          findUnique: mocks.findUnique,
        },
      })
    );
    mocks.findConversation.mockResolvedValue({ id: "conversation-1", projectId: "project-1" });
    mocks.findProject.mockResolvedValue({ id: "project-1" });
    mocks.createExecution.mockResolvedValue({
      id: "run-1",
      userId: "user-1",
      conversationId: "conversation-1",
      projectId: "project-1",
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
    });
    mocks.createEvent.mockResolvedValue({});

    const execution = await new PrismaAgentExecutionStore().create({
      userId: "user-1",
      conversationId: "conversation-1",
      projectId: "project-1",
      checkpoint: checkpoint(),
      scheduledAt: now,
    });

    expect(execution).toMatchObject({
      id: "run-1",
      status: "queued",
      lastEventSequence: 1,
    });
    expect(mocks.createExecution).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        conversationId: "conversation-1",
        projectId: "project-1",
        checkpoint: checkpoint(),
        scheduledAt: now,
        lastEventSequence: 1,
      },
    });
    expect(mocks.createEvent).toHaveBeenCalledWith({
      data: {
        executionId: "run-1",
        sequence: 1,
        key: "run_queued",
        type: "run_queued",
        payload: { scheduledAt: "2026-07-19T12:00:00.000Z" },
        createdAt: now,
      },
    });
  });

  it("creates stable user and assistant messages in the idempotent dispatch transaction", async () => {
    const now = new Date("2026-07-19T12:00:00.000Z");
    mocks.transaction.mockImplementation(async (operation) =>
      operation({
        conversation: {
          findFirst: mocks.findConversation,
          create: mocks.createConversation,
        },
        project: { findFirst: mocks.findProject },
        message: { create: mocks.createMessage },
        agentExecution: {
          findUnique: mocks.findExecutionUnique,
          create: mocks.createExecution,
        },
        agentExecutionEvent: { create: mocks.createEvent },
      })
    );
    mocks.findExecutionUnique.mockResolvedValue(null);
    mocks.findConversation.mockResolvedValue({
      id: "conversation-1",
      projectId: "project-1",
    });
    mocks.createMessage
      .mockResolvedValueOnce({ id: "message-user-1" })
      .mockResolvedValueOnce({ id: "message-assistant-1" });
    mocks.createExecution.mockResolvedValue({
      id: "run-1",
      userId: "user-1",
      clientRunKey: "client-run-1",
      requestHash: "sha256:request-1",
      userMessageId: "message-user-1",
      assistantMessageId: "message-assistant-1",
      conversationId: "conversation-1",
      projectId: "project-1",
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
    });
    mocks.createEvent.mockResolvedValue({});

    const result =
      await new PrismaAgentExecutionStore().createOrGetByClientRunKey({
        userId: "user-1",
        clientRunKey: "client-run-1",
        requestHash: "sha256:request-1",
        conversation: {
          id: "conversation-1",
          projectId: "project-1",
          title: "Ignored for an existing conversation",
          model: "deepseek-v4-pro",
          thinkingEnabled: true,
        },
        userMessageContent: "Explain Kirchhoff's law",
        checkpoint: checkpoint(),
        scheduledAt: now,
      });

    expect(result).toMatchObject({
      created: true,
      execution: {
        id: "run-1",
        userMessageId: "message-user-1",
        assistantMessageId: "message-assistant-1",
      },
    });
    expect(mocks.createMessage).toHaveBeenNthCalledWith(1, {
      data: {
        conversationId: "conversation-1",
        role: "user",
        content: "Explain Kirchhoff's law",
      },
      select: { id: true },
    });
    expect(mocks.createMessage).toHaveBeenNthCalledWith(2, {
      data: {
        conversationId: "conversation-1",
        role: "assistant",
        content: "",
      },
      select: { id: true },
    });
    expect(mocks.createExecution).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        clientRunKey: "client-run-1",
        requestHash: "sha256:request-1",
        userMessageId: "message-user-1",
        assistantMessageId: "message-assistant-1",
        conversationId: "conversation-1",
        projectId: "project-1",
        checkpoint: checkpoint(),
        scheduledAt: now,
        lastEventSequence: 1,
      },
    });
  });

  it("returns the original execution when the same client run key and request hash are retried", async () => {
    const now = new Date("2026-07-19T12:00:00.000Z");
    const existing = {
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
    mocks.transaction.mockImplementation(async (operation) =>
      operation({
        agentExecution: { findUnique: mocks.findExecutionUnique },
      })
    );
    mocks.findExecutionUnique.mockResolvedValue(existing);

    const result =
      await new PrismaAgentExecutionStore().createOrGetByClientRunKey({
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
        scheduledAt: now,
      });

    expect(result).toEqual({
      created: false,
      execution: existing,
    });
    expect(mocks.createMessage).not.toHaveBeenCalled();
    expect(mocks.createExecution).not.toHaveBeenCalled();
  });

  it("rejects reuse of a client run key with a different request hash", async () => {
    const now = new Date("2026-07-19T12:00:00.000Z");
    mocks.transaction.mockImplementation(async (operation) =>
      operation({
        agentExecution: { findUnique: mocks.findExecutionUnique },
      })
    );
    mocks.findExecutionUnique.mockResolvedValue({
      id: "run-1",
      requestHash: "sha256:original",
    });

    await expect(
      new PrismaAgentExecutionStore().createOrGetByClientRunKey({
        userId: "user-1",
        clientRunKey: "client-run-1",
        requestHash: "sha256:different",
        conversation: {
          id: "conversation-1",
          title: "Existing",
          model: "deepseek-v4-pro",
          thinkingEnabled: true,
        },
        userMessageContent: "A different request",
        checkpoint: checkpoint(),
        scheduledAt: now,
      })
    ).rejects.toMatchObject({ code: "idempotency_key_reused" });

    expect(mocks.createMessage).not.toHaveBeenCalled();
    expect(mocks.createExecution).not.toHaveBeenCalled();
  });

  it("resolves a concurrent idempotent insert race to the committed execution", async () => {
    const now = new Date("2026-07-19T12:00:00.000Z");
    const existing = {
      id: "run-winner",
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
    mocks.transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("unique", {
        code: "P2002",
        clientVersion: "test",
      })
    );
    mocks.findExecutionUnique.mockResolvedValue(existing);

    await expect(
      new PrismaAgentExecutionStore().createOrGetByClientRunKey({
        userId: "user-1",
        clientRunKey: "client-run-1",
        requestHash: "sha256:request-1",
        conversation: {
          id: "conversation-1",
          title: "Existing",
          model: "deepseek-v4-pro",
          thinkingEnabled: true,
        },
        userMessageContent: "same request",
        checkpoint: checkpoint(),
        scheduledAt: now,
      })
    ).resolves.toEqual({ execution: existing, created: false });
  });

  it("maps a different active run unique conflict to the frozen error code", async () => {
    mocks.transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("unique", {
        code: "P2002",
        clientVersion: "test",
      })
    );
    mocks.findExecutionUnique.mockResolvedValue(null);

    await expect(
      new PrismaAgentExecutionStore().createOrGetByClientRunKey({
        userId: "user-1",
        clientRunKey: "client-run-new",
        requestHash: "sha256:new",
        conversation: {
          id: "conversation-1",
          title: "Existing",
          model: "deepseek-v4-pro",
          thinkingEnabled: true,
        },
        userMessageContent: "new request",
        checkpoint: checkpoint(),
      })
    ).rejects.toMatchObject({ code: "conversation_execution_in_progress" });
  });

  it("returns an execution only when it belongs to the requesting user", async () => {
    const now = new Date("2026-07-19T12:00:00.000Z");
    mocks.findFirst
      .mockResolvedValueOnce({
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
      })
      .mockResolvedValueOnce(null);

    const store = new PrismaAgentExecutionStore();

    await expect(
      store.getOwnedExecution({ executionId: "run-1", userId: "user-1" })
    ).resolves.toMatchObject({
      id: "run-1",
      clientRunKey: "client-run-1",
      userMessageId: "message-user-1",
      assistantMessageId: "message-assistant-1",
    });
    await expect(
      store.getOwnedExecution({ executionId: "run-1", userId: "user-2" })
    ).resolves.toBeNull();
    expect(mocks.findFirst).toHaveBeenNthCalledWith(1, {
      where: { id: "run-1", userId: "user-1" },
    });
  });

  it("replays owned events strictly after the supplied sequence", async () => {
    const now = new Date("2026-07-19T12:00:00.000Z");
    mocks.findFirst.mockResolvedValue({ id: "run-1" });
    mocks.findEvents.mockResolvedValue([
      {
        id: "event-3",
        executionId: "run-1",
        sequence: 3,
        key: "run_completed",
        type: "run_completed",
        payload: null,
        createdAt: now,
      },
    ]);

    const events = await new PrismaAgentExecutionStore().listEventsAfter({
      executionId: "run-1",
      userId: "user-1",
      afterSequence: 2,
      limit: 25,
    });

    expect(events).toEqual([
      expect.objectContaining({ executionId: "run-1", sequence: 3 }),
    ]);
    expect(mocks.findEvents).toHaveBeenCalledWith({
      where: { executionId: "run-1", sequence: { gt: 2 } },
      orderBy: { sequence: "asc" },
      take: 25,
    });
  });

  it("does not reveal events for an execution owned by another user", async () => {
    mocks.findFirst.mockResolvedValue(null);

    await expect(
      new PrismaAgentExecutionStore().listEventsAfter({
        executionId: "run-1",
        userId: "user-2",
        afterSequence: 0,
      })
    ).resolves.toBeNull();
    expect(mocks.findEvents).not.toHaveBeenCalled();
  });

  it("refuses to create a run for a conversation not owned by the user", async () => {
    mocks.transaction.mockImplementation(async (operation) =>
      operation({
        conversation: { findFirst: mocks.findConversation },
        project: { findFirst: mocks.findProject },
        agentExecution: { create: mocks.createExecution },
        agentExecutionEvent: { create: mocks.createEvent },
      })
    );
    mocks.findConversation.mockResolvedValue(null);

    await expect(
      new PrismaAgentExecutionStore().create({
        userId: "user-1",
        conversationId: "conversation-owned-by-another-user",
        checkpoint: checkpoint(),
      })
    ).rejects.toThrow("Agent execution conversation is not owned by the user");

    expect(mocks.createExecution).not.toHaveBeenCalled();
  });

  it("refuses to create a run whose project differs from its conversation", async () => {
    mocks.transaction.mockImplementation(async (operation) =>
      operation({
        conversation: { findFirst: mocks.findConversation },
        project: { findFirst: mocks.findProject },
        agentExecution: { create: mocks.createExecution },
        agentExecutionEvent: { create: mocks.createEvent },
      })
    );
    mocks.findConversation.mockResolvedValue({ id: "conversation-1", projectId: "project-a" });
    mocks.findProject.mockResolvedValue({ id: "project-b" });

    await expect(
      new PrismaAgentExecutionStore().create({
        userId: "user-1",
        conversationId: "conversation-1",
        projectId: "project-b",
        checkpoint: checkpoint(),
      })
    ).rejects.toThrow("Agent execution project does not match the conversation");

    expect(mocks.createExecution).not.toHaveBeenCalled();
  });

  it("atomically claims only a ready queued execution for one worker", async () => {
    const now = new Date("2026-07-19T12:00:00.000Z");
    mocks.findFirst.mockResolvedValue({
      id: "run-1",
      userId: "user-1",
      conversationId: "conversation-1",
      projectId: null,
      status: "queued",
      checkpoint: checkpoint(),
      attempt: 0,
      scheduledAt: now,
      waitingToolExecutionId: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      lastEventSequence: 2,
      createdAt: now,
      updatedAt: now,
    });
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.transaction.mockImplementation(async (operation) =>
      operation({
        agentExecution: { updateMany: mocks.updateMany, update: mocks.update },
        agentExecutionEvent: { create: mocks.createEvent },
      })
    );
    mocks.update.mockResolvedValue({ attempt: 1, lastEventSequence: 3 });
    mocks.createEvent.mockResolvedValue({});

    const result = await new PrismaAgentExecutionStore().claimNext({
      workerId: "worker-a",
      now,
      leaseMs: 30_000,
    });

    expect(result).toMatchObject({
      id: "run-1",
      status: "running",
      leaseOwner: "worker-a",
      attempt: 1,
    });
    expect(result?.leaseExpiresAt).toEqual(
      new Date("2026-07-19T12:00:30.000Z")
    );
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        id: "run-1",
        status: "queued",
        scheduledAt: { lte: now },
      },
      data: {
        status: "running",
        leaseOwner: "worker-a",
        leaseExpiresAt: new Date("2026-07-19T12:00:30.000Z"),
        attempt: { increment: 1 },
      },
    });
  });

  it("writes the successful claim and its event in one transaction", async () => {
    const now = new Date("2026-07-19T12:00:00.000Z");
    mocks.findFirst.mockResolvedValue({
      id: "run-1",
      userId: "user-1",
      conversationId: "conversation-1",
      projectId: null,
      status: "queued",
      checkpoint: checkpoint(),
      attempt: 0,
      scheduledAt: now,
      waitingToolExecutionId: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      lastEventSequence: 1,
      failure: null,
      createdAt: now,
      updatedAt: now,
    });
    mocks.transaction.mockImplementation(async (operation) =>
      operation({
        agentExecution: { updateMany: mocks.updateMany, update: mocks.update },
        agentExecutionEvent: { create: mocks.createEvent },
      })
    );
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.update.mockResolvedValue({ attempt: 1, lastEventSequence: 2 });
    mocks.createEvent.mockResolvedValue({});

    await new PrismaAgentExecutionStore().claimNext({
      workerId: "worker-a",
      now,
      leaseMs: 30_000,
    });

    expect(mocks.createEvent).toHaveBeenCalledWith({
      data: {
        executionId: "run-1",
        sequence: 2,
        key: "run_claimed:1",
        type: "run_claimed",
        payload: { workerId: "worker-a", attempt: 1 },
        createdAt: now,
      },
    });
  });

  it("continues to another queued candidate after losing a claim race", async () => {
    const now = new Date("2026-07-19T12:00:00.000Z");
    const queued = (id: string) => ({
      id,
      userId: "user-1",
      clientRunKey: `client-${id}`,
      requestHash: `sha256:${id}`,
      userMessageId: `user-message-${id}`,
      assistantMessageId: `assistant-message-${id}`,
      conversationId: `conversation-${id}`,
      projectId: null,
      status: "queued",
      checkpoint: checkpoint(),
      attempt: 0,
      scheduledAt: now,
      waitingToolExecutionId: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      lastEventSequence: 1,
      failure: null,
      createdAt: now,
      updatedAt: now,
    });
    mocks.findFirst
      .mockResolvedValueOnce(queued("run-lost"))
      .mockResolvedValueOnce(queued("run-won"));
    mocks.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    mocks.update.mockResolvedValue({
      attempt: 1,
      lastEventSequence: 2,
    });
    mocks.createEvent.mockResolvedValue({});
    mocks.transaction.mockImplementation(async (operation) =>
      operation({
        agentExecution: {
          updateMany: mocks.updateMany,
          update: mocks.update,
        },
        agentExecutionEvent: { create: mocks.createEvent },
      })
    );

    const result = await new PrismaAgentExecutionStore().claimNext({
      workerId: "worker-a",
      now,
      leaseMs: 30_000,
    });

    expect(result).toMatchObject({ id: "run-won", leaseOwner: "worker-a" });
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    expect(mocks.findFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          id: { notIn: ["run-lost"] },
        }),
      })
    );
  });

  it("requeues only expired running executions", async () => {
    const now = new Date("2026-07-19T12:00:00.000Z");
    mocks.findMany.mockResolvedValue([
      { id: "run-1", attempt: 1 },
      { id: "run-2", attempt: 2 },
    ]);
    mocks.transaction.mockImplementation(async (operation) =>
      operation({
        agentExecution: { updateMany: mocks.updateMany, update: mocks.update },
        agentExecutionEvent: { create: mocks.createEvent },
        toolExecution: { updateMany: mocks.updateToolExecution },
      })
    );
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.update.mockResolvedValue({ lastEventSequence: 3 });
    mocks.createEvent.mockResolvedValue({});
    mocks.updateToolExecution.mockResolvedValue({ count: 0 });

    const recovered = await new PrismaAgentExecutionStore().recoverExpired({ now });

    expect(recovered).toBe(2);
    expect(mocks.updateToolExecution).toHaveBeenCalledWith({
      where: { agentExecutionId: "run-1", status: "executing" },
      data: {
        status: "failed",
        completedAt: now,
        errorSummary: {
          code: "TOOL_EXECUTION_OUTCOME_UNKNOWN",
          message: "执行租约丢失，工具结果未知；请勿盲目重试有副作用的操作",
        },
      },
    });
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        id: "run-1",
        status: "running",
        leaseExpiresAt: { lt: now },
      },
      data: {
        status: "queued",
        leaseOwner: null,
        leaseExpiresAt: null,
        scheduledAt: now,
      },
    });
  });

  it("fails an expired poison run instead of requeueing it forever", async () => {
    const now = new Date("2026-07-19T12:00:00.000Z");
    mocks.findMany.mockResolvedValue([{ id: "run-poison", attempt: 3 }]);
    mocks.transaction.mockImplementation(async (operation) =>
      operation({
        agentExecution: {
          updateMany: mocks.updateMany,
          update: mocks.update,
        },
        agentExecutionEvent: { create: mocks.createEvent },
        toolExecution: { updateMany: mocks.updateToolExecution },
      })
    );
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.update.mockResolvedValue({ lastEventSequence: 8 });
    mocks.createEvent.mockResolvedValue({});
    mocks.updateToolExecution.mockResolvedValue({ count: 0 });

    await expect(
      new PrismaAgentExecutionStore().recoverExpired({
        now,
        maxAttempts: 3,
      })
    ).resolves.toBe(1);

    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        id: "run-poison",
        status: "running",
        leaseExpiresAt: { lt: now },
      },
      data: {
        status: "failed",
        leaseOwner: null,
        leaseExpiresAt: null,
        failure: {
          code: "max_attempts_exceeded",
          message: "Execution lease expired after the maximum number of attempts",
          retryable: false,
          attempt: 3,
        },
      },
    });
    expect(mocks.createEvent).toHaveBeenCalledWith({
      data: {
        executionId: "run-poison",
        sequence: 8,
        key: "lease_poisoned:3",
        type: "run_failed",
        payload: {
          failureCode: "max_attempts_exceeded",
          attempt: 3,
        },
        createdAt: now,
      },
    });
  });

  it("appends monotonically sequenced events inside one transaction", async () => {
    const now = new Date("2026-07-19T12:00:00.000Z");
    mocks.transaction.mockImplementation(async (operation) =>
      operation({
        agentExecution: {
          findFirst: mocks.findFirst,
          updateManyAndReturn: mocks.updateManyAndReturn,
        },
        agentExecutionEvent: {
          create: mocks.createEvent,
          findUnique: mocks.findUnique,
        },
      })
    );
    mocks.findFirst.mockResolvedValue({ id: "run-1" });
    mocks.updateManyAndReturn.mockResolvedValue([{ lastEventSequence: 3 }]);
    mocks.findUnique.mockResolvedValue(null);
    mocks.createEvent.mockResolvedValue({
      id: "event-3",
      executionId: "run-1",
      sequence: 3,
      key: "worker-a:run-started:1",
      type: "run_started",
      payload: { workerId: "worker-a" },
      createdAt: now,
    });

    const event = await new PrismaAgentExecutionStore().appendEvent({
      executionId: "run-1",
      workerId: "worker-a",
      key: "worker-a:run-started:1",
      type: "run_started",
      payload: { workerId: "worker-a" },
      now,
    });

    expect(event).toEqual({
      id: "event-3",
      executionId: "run-1",
      sequence: 3,
      key: "worker-a:run-started:1",
      type: "run_started",
      payload: { workerId: "worker-a" },
      createdAt: now,
    });
    expect(mocks.updateManyAndReturn).toHaveBeenCalledWith({
      where: {
        id: "run-1",
        status: "running",
        leaseOwner: "worker-a",
        leaseExpiresAt: { gt: now },
      },
      data: { lastEventSequence: { increment: 1 } },
      select: { lastEventSequence: true },
    });
    expect(mocks.createEvent).toHaveBeenCalledWith({
      data: {
        executionId: "run-1",
        sequence: 3,
        key: "worker-a:run-started:1",
        type: "run_started",
        payload: { workerId: "worker-a" },
        createdAt: now,
      },
    });
  });

  it("returns the existing event when the producer retries the same key", async () => {
    const now = new Date("2026-07-19T12:00:00.000Z");
    const existing = {
      id: "event-3",
      executionId: "run-1",
      sequence: 3,
      key: "worker-a:run-started:1",
      type: "run_started",
      payload: { workerId: "worker-a" },
      createdAt: now,
    };
    mocks.transaction.mockImplementation(async (operation) =>
      operation({
        agentExecution: {
          findFirst: mocks.findFirst,
          updateManyAndReturn: mocks.updateManyAndReturn,
        },
        agentExecutionEvent: {
          create: mocks.createEvent,
          findUnique: mocks.findUnique,
        },
      })
    );
    mocks.findFirst.mockResolvedValue({ id: "run-1" });
    mocks.findUnique.mockResolvedValue(existing);

    const event = await new PrismaAgentExecutionStore().appendEvent({
      executionId: "run-1",
      workerId: "worker-a",
      key: "worker-a:run-started:1",
      type: "run_started",
      payload: { workerId: "worker-a" },
      now,
    });

    expect(event).toEqual(existing);
    expect(mocks.updateManyAndReturn).not.toHaveBeenCalled();
    expect(mocks.createEvent).not.toHaveBeenCalled();
  });

  it("rejects an event from a worker whose lease is no longer current", async () => {
    const now = new Date("2026-07-19T12:00:00.000Z");
    mocks.transaction.mockImplementation(async (operation) =>
      operation({
        agentExecution: {
          findFirst: mocks.findFirst,
          updateManyAndReturn: mocks.updateManyAndReturn,
        },
        agentExecutionEvent: {
          create: mocks.createEvent,
          findUnique: mocks.findUnique,
        },
      })
    );
    mocks.findFirst.mockResolvedValue(null);
    mocks.updateManyAndReturn.mockResolvedValue([]);
    mocks.findUnique.mockResolvedValue(null);

    await expect(
      new PrismaAgentExecutionStore().appendEvent({
        executionId: "run-1",
        workerId: "stale-worker",
        key: "stale:event",
        type: "assistant_delta",
        payload: { text: "must not persist" },
        now,
      })
    ).rejects.toMatchObject({ code: "execution_lease_lost" });

    expect(mocks.createEvent).not.toHaveBeenCalled();
  });

  it("does not treat a duplicate event key as success after lease loss", async () => {
    const now = new Date("2026-07-19T12:00:00.000Z");
    mocks.transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("unique", {
        code: "P2002",
        clientVersion: "test",
      })
    );
    mocks.findFirst.mockResolvedValue(null);
    mocks.findUnique.mockResolvedValue({
      id: "event-existing",
      executionId: "run-1",
      sequence: 3,
      key: "worker-a:delta:1",
      type: "assistant_delta",
      payload: { text: "already persisted" },
      createdAt: now,
    });

    await expect(
      new PrismaAgentExecutionStore().appendEvent({
        executionId: "run-1",
        workerId: "worker-a",
        key: "worker-a:delta:1",
        type: "assistant_delta",
        payload: { text: "already persisted" },
        now,
      })
    ).rejects.toMatchObject({ code: "execution_lease_lost" });
  });

  it("saves a checkpoint only while the worker owns an unexpired lease", async () => {
    const now = new Date("2026-07-19T12:00:00.000Z");
    mocks.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const store = new PrismaAgentExecutionStore();

    await expect(
      store.saveCheckpoint({
        executionId: "run-1",
        workerId: "worker-a",
        checkpoint: checkpoint(),
        now,
      })
    ).resolves.toBe(true);
    await expect(
      store.saveCheckpoint({
        executionId: "run-1",
        workerId: "stale-worker",
        checkpoint: checkpoint(),
        now,
      })
    ).resolves.toBe(false);

    expect(mocks.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: "run-1",
        status: "running",
        leaseOwner: "worker-a",
        leaseExpiresAt: { gt: now },
      },
      data: { checkpoint: checkpoint() },
    });
  });

  it("marks a run completed and writes its terminal event under the same lease fence", async () => {
    const now = new Date("2026-07-19T12:00:00.000Z");
    const completed = {
      id: "run-1",
      lastEventSequence: 5,
    };
    mocks.transaction.mockImplementation(async (operation) =>
      operation({
        agentExecution: {
          updateManyAndReturn: mocks.updateManyAndReturn,
        },
        agentExecutionEvent: { create: mocks.createEvent },
      })
    );
    mocks.updateManyAndReturn.mockResolvedValue([completed]);
    mocks.createEvent.mockResolvedValue({});

    await expect(
      new PrismaAgentExecutionStore().markCompleted({
        executionId: "run-1",
        workerId: "worker-a",
        now,
      })
    ).resolves.toBe(true);

    expect(mocks.updateManyAndReturn).toHaveBeenCalledWith({
      where: {
        id: "run-1",
        status: "running",
        leaseOwner: "worker-a",
        leaseExpiresAt: { gt: now },
      },
      data: {
        status: "completed",
        leaseOwner: null,
        leaseExpiresAt: null,
        waitingToolExecutionId: null,
        failure: expect.anything(),
        lastEventSequence: { increment: 1 },
      },
      select: { id: true, attempt: true, lastEventSequence: true },
    });
    expect(mocks.createEvent).toHaveBeenCalledWith({
      data: {
        executionId: "run-1",
        sequence: 5,
        key: "run_completed",
        type: "run_completed",
        payload: {},
        createdAt: now,
      },
    });
  });

  it("does not schedule a retry after the worker loses its lease", async () => {
    const now = new Date("2026-07-19T12:00:00.000Z");
    const scheduledAt = new Date("2026-07-19T12:00:05.000Z");
    mocks.transaction.mockImplementation(async (operation) =>
      operation({
        agentExecution: {
          updateManyAndReturn: mocks.updateManyAndReturn,
        },
        agentExecutionEvent: { create: mocks.createEvent },
      })
    );
    mocks.updateManyAndReturn.mockResolvedValue([]);

    await expect(
      new PrismaAgentExecutionStore().scheduleRetry({
        executionId: "run-1",
        workerId: "stale-worker",
        failure: {
          code: "provider_unavailable",
          message: "temporary",
          retryable: true,
        },
        scheduledAt,
        now,
      })
    ).resolves.toBe(false);

    expect(mocks.createEvent).not.toHaveBeenCalled();
  });

  it("renews a lease only for its current worker before it expires", async () => {
    const now = new Date("2026-07-19T12:00:00.000Z");
    mocks.updateMany.mockResolvedValue({ count: 1 });

    const renewed = await new PrismaAgentExecutionStore().renewLease({
      executionId: "run-1",
      workerId: "worker-a",
      now,
      leaseMs: 30_000,
    });

    expect(renewed).toBe(true);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        id: "run-1",
        status: "running",
        leaseOwner: "worker-a",
        leaseExpiresAt: { gt: now },
      },
      data: {
        leaseExpiresAt: new Date("2026-07-19T12:00:30.000Z"),
      },
    });
  });

  it("refuses an expired worker when it tries to wait for approval", async () => {
    const now = new Date("2026-07-19T12:00:00.000Z");
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.transaction.mockImplementation(async (operation) =>
      operation({
        agentExecution: {
          findFirst: mocks.findFirst,
          updateMany: mocks.updateMany,
          update: mocks.update,
        },
        toolExecution: {
          findFirst: mocks.findToolExecution,
          updateMany: mocks.updateToolExecution,
        },
        agentExecutionEvent: { create: mocks.createEvent },
      })
    );
    mocks.findFirst.mockResolvedValue({ userId: "user-1", conversationId: "conversation-1" });
    mocks.findToolExecution.mockResolvedValue({ id: "tool-1", status: "succeeded" });
    mocks.updateToolExecution.mockResolvedValue({ count: 1 });

    const paused = await new PrismaAgentExecutionStore().markWaitingForApproval({
      executionId: "run-1",
      workerId: "worker-a",
      toolExecutionId: "tool-1",
      checkpoint: checkpoint(),
      now,
    });

    expect(paused).toBe(false);
    expect(mocks.updateToolExecution).toHaveBeenCalledWith({
      where: {
        id: "tool-1",
        agentExecutionId: "run-1",
        userId: "user-1",
        conversationId: "conversation-1",
        status: "pending_approval",
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      data: { status: "pending_approval" },
    });
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        id: "run-1",
        status: "running",
        leaseOwner: "worker-a",
        leaseExpiresAt: { gt: now },
      },
      data: expect.objectContaining({ status: "waiting_approval" }),
    });
  });

  it("refuses to wait on a tool execution from a different user or conversation", async () => {
    const now = new Date("2026-07-19T12:00:00.000Z");
    mocks.transaction.mockImplementation(async (operation) =>
      operation({
        agentExecution: {
          findFirst: mocks.findFirst,
          updateMany: mocks.updateMany,
          update: mocks.update,
        },
        toolExecution: {
          findFirst: mocks.findToolExecution,
          updateMany: mocks.updateToolExecution,
        },
        agentExecutionEvent: { create: mocks.createEvent },
      })
    );
    mocks.findFirst.mockResolvedValue({ userId: "user-1", conversationId: "conversation-1" });
    mocks.findToolExecution.mockResolvedValue(null);
    mocks.updateToolExecution.mockResolvedValue({ count: 0 });
    mocks.updateMany.mockResolvedValue({ count: 1 });

    const paused = await new PrismaAgentExecutionStore().markWaitingForApproval({
      executionId: "run-1",
      workerId: "worker-a",
      toolExecutionId: "tool-for-another-user",
      checkpoint: checkpoint(),
      now,
    });

    expect(paused).toBe(false);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("atomically requeues only after the owned tool is approved or terminal", async () => {
    const now = new Date("2026-07-19T12:00:00.000Z");
    mocks.transaction.mockImplementation(async (operation) =>
      operation({
        agentExecution: {
          findFirst: mocks.findFirst,
          updateMany: mocks.updateMany,
          update: mocks.update,
        },
        toolExecution: {
          findFirst: mocks.findToolExecution,
          updateMany: mocks.updateToolExecution,
        },
        agentExecutionEvent: { create: mocks.createEvent },
      })
    );
    mocks.findFirst.mockResolvedValue({ userId: "user-1", conversationId: "conversation-1" });
    mocks.findToolExecution.mockResolvedValue({ id: "tool-1", status: "succeeded" });
    mocks.updateToolExecution.mockResolvedValue({ count: 1 });
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.update.mockResolvedValue({ lastEventSequence: 4 });
    mocks.createEvent.mockResolvedValue({});

    const queued = await new PrismaAgentExecutionStore().enqueueAfterApproval({
      executionId: "run-1",
      toolExecutionId: "tool-1",
      now,
    });

    expect(queued).toBe(true);
    expect(mocks.findToolExecution).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: "tool-1",
        agentExecutionId: "run-1",
        userId: "user-1",
        conversationId: "conversation-1",
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
      }),
      select: { id: true, status: true },
    });
    expect(mocks.updateToolExecution).toHaveBeenCalledWith({
      where: {
        id: "tool-1",
        agentExecutionId: "run-1",
        userId: "user-1",
        conversationId: "conversation-1",
        status: "succeeded",
      },
      data: { status: "succeeded" },
    });
    expect(mocks.createEvent).toHaveBeenCalledWith({
      data: {
        executionId: "run-1",
        sequence: 4,
        key: "approval_resumed:tool-1",
        type: "approval_resumed",
        payload: { toolExecutionId: "tool-1" },
        createdAt: now,
      },
    });
  });

  it("expires a pending approval and requeues the same execution atomically", async () => {
    const now = new Date("2026-07-19T12:00:00.000Z");
    mocks.transaction.mockImplementation(async (operation) =>
      operation({
        agentExecution: {
          findFirst: mocks.findFirst,
          updateMany: mocks.updateMany,
          update: mocks.update,
        },
        toolExecution: {
          updateMany: mocks.updateToolExecution,
        },
        agentExecutionEvent: { create: mocks.createEvent },
      })
    );
    mocks.findFirst.mockResolvedValue({
      userId: "user-1",
      conversationId: "conversation-1",
    });
    mocks.updateToolExecution.mockResolvedValue({ count: 1 });
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.update.mockResolvedValue({ lastEventSequence: 5 });
    mocks.createEvent.mockResolvedValue({});

    await expect(
      new PrismaAgentExecutionStore().expireWaitingApproval({
        executionId: "run-1",
        toolExecutionId: "tool-1",
        now,
      })
    ).resolves.toBe(true);

    expect(mocks.updateToolExecution).toHaveBeenCalledWith({
      where: {
        id: "tool-1",
        agentExecutionId: "run-1",
        userId: "user-1",
        conversationId: "conversation-1",
        status: "pending_approval",
        expiresAt: { lte: now },
      },
      data: {
        status: "expired",
        completedAt: now,
        errorSummary: {
          code: "APPROVAL_EXPIRED",
          message: "Approval expired before the tool could run",
        },
      },
    });
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        id: "run-1",
        status: "waiting_approval",
        waitingToolExecutionId: "tool-1",
      },
      data: {
        status: "queued",
        scheduledAt: now,
      },
    });
  });

  it.each([
    ["claimNext", (store: PrismaAgentExecutionStore) => store.claimNext({ workerId: "worker-a", now: new Date(), leaseMs: 0 })],
    ["renewLease", (store: PrismaAgentExecutionStore) => store.renewLease({ executionId: "run-1", workerId: "worker-a", now: new Date(), leaseMs: -1 })],
  ])("rejects a non-positive lease duration in %s", async (_name, execute) => {
    await expect(execute(new PrismaAgentExecutionStore())).rejects.toThrow(
      "leaseMs must be a positive finite number"
    );
  });

  it("rejects a checkpoint outside the provider-neutral contract before writing", async () => {
    await expect(
      new PrismaAgentExecutionStore().create({
        userId: "user-1",
        conversationId: "conversation-1",
        checkpoint: {
          version: 1,
          providerResumeToken: "private-token",
        } as unknown as AgentCheckpoint,
      })
    ).rejects.toThrow("Agent checkpoint is invalid");

    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("accepts completed checkpoints with non-secret token usage counters", () => {
    expect(() =>
      parseAgentCheckpoint({
        ...checkpoint(),
        output: {
          text: "stable answer",
          reasoning: "",
          usage: {
            promptTokens: 10,
            completionTokens: 5,
            totalTokens: 15,
            promptCacheHitTokens: 2,
            promptCacheMissTokens: 8,
          },
        },
      })
    ).not.toThrow();
  });

  it("accepts cumulative token usage counters on an approval checkpoint", () => {
    expect(() =>
      parseAgentCheckpoint({
        ...checkpoint(),
        usage: {
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
          promptCacheHitTokens: 2,
          promptCacheMissTokens: 8,
        },
        pendingToolCall: {
          id: "call-1",
          toolId: "artifact.save",
          arguments: { toolExecutionId: "call-1" },
        },
      })
    ).not.toThrow();
  });

  it("rejects non-JSON and provider-private values nested in a pending tool call", async () => {
    const store = new PrismaAgentExecutionStore();
    const base = checkpoint();

    await expect(
      store.create({
        userId: "user-1",
        conversationId: "conversation-1",
        checkpoint: {
          ...base,
          pendingToolCall: {
            id: "call-1",
            toolId: "web.fetch",
            arguments: { request: { providerResumeToken: "private-token" } },
          },
        },
      })
    ).rejects.toThrow("Agent checkpoint is invalid");

    await expect(
      store.create({
        userId: "user-1",
        conversationId: "conversation-1",
        checkpoint: {
          ...base,
          pendingToolCall: {
            id: "call-1",
            toolId: "web.fetch",
            arguments: { promptTokens: "private-token" },
          },
        },
      })
    ).rejects.toThrow("Agent checkpoint is invalid");

    await expect(
      store.create({
        userId: "user-1",
        conversationId: "conversation-1",
        checkpoint: {
          ...base,
          pendingToolCall: {
            id: "call-1",
            toolId: "web.fetch",
            arguments: { request: { headers: { Authorization: "Bearer private-token" } } },
          },
        },
      })
    ).rejects.toThrow("Agent checkpoint is invalid");

    await expect(
      store.create({
        userId: "user-1",
        conversationId: "conversation-1",
        checkpoint: {
          ...base,
          pendingToolCall: {
            id: "call-1",
            toolId: "web.fetch",
            arguments: { retryAfter: BigInt(1) },
          },
        },
      })
    ).rejects.toThrow("Agent checkpoint is invalid");

    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects an oversized checkpoint before opening a transaction", async () => {
    await expect(
      new PrismaAgentExecutionStore().create({
        userId: "user-1",
        conversationId: "conversation-1",
        checkpoint: {
          ...checkpoint(),
          messages: [
            {
              role: "user",
              content: "x".repeat(2_000_001),
            },
          ],
        },
      })
    ).rejects.toThrow("Agent checkpoint is invalid");

    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
