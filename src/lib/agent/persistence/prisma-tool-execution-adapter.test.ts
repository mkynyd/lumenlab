import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    toolExecution: {
      findMany: mocks.findMany,
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
});
