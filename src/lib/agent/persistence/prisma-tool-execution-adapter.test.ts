import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findFirst: vi.fn(),
  create: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    toolExecution: {
      findMany: mocks.findMany,
      findFirst: mocks.findFirst,
      create: mocks.create,
    },
  },
}));

import { PrismaToolExecutionAdapter } from "./prisma-tool-execution-adapter";

describe("PrismaToolExecutionAdapter session approvals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("restores only successful low-risk approvals for the current conversation", async () => {
    mocks.findMany.mockResolvedValue([
      { toolId: "project_files.list" },
      { toolId: "artifact.list" },
    ]);

    const approvals =
      await new PrismaToolExecutionAdapter().loadSessionApprovals({
        userId: "user-1",
        conversationId: "conversation-1",
      });

    expect(approvals).toEqual(
      new Map([
        ["project_files.list", "session"],
        ["artifact.list", "session"],
      ])
    );
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        conversationId: "conversation-1",
        approvalScope: "session",
        status: "succeeded",
        riskLevel: { in: ["L0", "L1", "L2"] },
      },
      select: { toolId: true },
      distinct: ["toolId"],
    });
  });

  it("uses provider call identity instead of collapsing equal arguments", async () => {
    mocks.findFirst.mockResolvedValue(null);
    mocks.create.mockResolvedValue({
      id: "tool-row-2",
      status: "proposed",
      resultSummary: null,
      errorSummary: null,
    });
    await new PrismaToolExecutionAdapter().propose({
      userId: "user-1",
      conversationId: "conversation-1",
      agentExecutionId: "run-1",
      providerToolCallId: "call-2",
      tool: {
        toolId: "artifact.save",
        name: "Save",
        description: "Save",
        inputSchema: {},
        outputSchema: {},
        riskLevel: "L2",
        isReadOnly: false,
        hasExternalSideEffect: true,
        isReversible: true,
        containsSensitiveData: false,
        requiresNetwork: false,
        defaultApprovalMode: "ask_each",
        allowedSkillIds: [],
        auditLevel: "standard",
        requiredScopes: [],
      },
      arguments: { title: "same" },
      riskLevel: "L2",
      contextSnapshot: {},
    });

    expect(mocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          agentExecutionId: "run-1",
          providerToolCallId: "call-2",
        },
      })
    );
    expect(mocks.create).toHaveBeenCalledOnce();
  });
});
