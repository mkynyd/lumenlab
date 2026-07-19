import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findConversation: vi.fn(),
  findProject: vi.fn(),
  findToolExecution: vi.fn(),
  updateToolExecution: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  update: vi.fn(),
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
      findMany: mocks.findMany,
      updateMany: mocks.updateMany,
      update: mocks.update,
    },
    agentExecutionEvent: {
      create: mocks.createEvent,
      findUnique: mocks.findUnique,
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
import type { AgentCheckpoint } from "./agent-execution-store";

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
      })
    );
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.update.mockResolvedValue({ lastEventSequence: 3 });
    mocks.createEvent.mockResolvedValue({});

    const recovered = await new PrismaAgentExecutionStore().recoverExpired({ now });

    expect(recovered).toBe(2);
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

  it("appends monotonically sequenced events inside one transaction", async () => {
    const now = new Date("2026-07-19T12:00:00.000Z");
    mocks.transaction.mockImplementation(async (operation) =>
      operation({
        agentExecution: {
          update: mocks.update,
        },
        agentExecutionEvent: {
          create: mocks.createEvent,
          findUnique: mocks.findUnique,
        },
      })
    );
    mocks.update.mockResolvedValue({ lastEventSequence: 3 });
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
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
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
        agentExecution: { update: mocks.update },
        agentExecutionEvent: {
          create: mocks.createEvent,
          findUnique: mocks.findUnique,
        },
      })
    );
    mocks.findUnique.mockResolvedValue(existing);

    const event = await new PrismaAgentExecutionStore().appendEvent({
      executionId: "run-1",
      key: "worker-a:run-started:1",
      type: "run_started",
      payload: { workerId: "worker-a" },
      now,
    });

    expect(event).toEqual(existing);
    expect(mocks.update).not.toHaveBeenCalled();
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

  it("atomically requeues only after the owned tool execution reaches a terminal state", async () => {
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
        userId: "user-1",
        conversationId: "conversation-1",
        status: { in: ["succeeded", "failed", "blocked", "rejected", "expired", "cancelled"] },
      }),
      select: { id: true, status: true },
    });
    expect(mocks.updateToolExecution).toHaveBeenCalledWith({
      where: {
        id: "tool-1",
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
});
