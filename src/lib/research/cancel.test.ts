import { beforeEach, describe, expect, it, vi } from "vitest";

const { prisma, cancelOwned } = vi.hoisted(() => ({
  prisma: { researchRun: { findFirst: vi.fn(), update: vi.fn() } },
  cancelOwned: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/agent/executions/prisma-agent-execution-store", () => ({
  PrismaAgentExecutionStore: class {
    cancelOwned = cancelOwned;
  },
}));

import { cancelResearchRun } from "./service";

describe("cancelResearchRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.researchRun.findFirst.mockResolvedValue({ status: "researching", agentExecutionId: "execution-1" });
    prisma.researchRun.update.mockResolvedValue({ id: "run-1", status: "cancelled" });
    cancelOwned.mockResolvedValue(true);
  });

  it("cancels the Research Run and its existing durable AgentExecution", async () => {
    await expect(cancelResearchRun("user-1", "run-1")).resolves.toMatchObject({ status: "cancelled" });
    expect(prisma.researchRun.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "run-1" }, data: expect.objectContaining({ status: "cancelled" }) }));
    expect(cancelOwned).toHaveBeenCalledWith(expect.objectContaining({ executionId: "execution-1", userId: "user-1" }));
  });
});
