import { beforeEach, describe, expect, it, vi } from "vitest";

const { prisma, createResearchAgentExecution } = vi.hoisted(() => ({
  prisma: {
    researchWorkspace: { findFirst: vi.fn(), update: vi.fn() },
    project: { findFirst: vi.fn() },
    researchRun: { create: vi.fn(), update: vi.fn(), findUniqueOrThrow: vi.fn() },
    researchPlanVersion: { aggregate: vi.fn(), create: vi.fn() },
    researchQuestion: { createMany: vi.fn() },
    $transaction: vi.fn(),
  },
  createResearchAgentExecution: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/agent/executions/prisma-agent-execution-store", () => ({
  PrismaAgentExecutionStore: class {},
}));
vi.mock("./durable-dispatcher", () => ({ createResearchAgentExecution, resumeResearchAgentExecution: vi.fn() }));

import { createResearchRun, updateResearchWorkspace, ResearchServiceError } from "./service";

const workspace = { id: "workspace-1", userId: "user-1", budgetProfile: "deep", domainProfileKey: "general" };

function stubTransaction() {
  prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) => callback(prisma));
  prisma.researchPlanVersion.aggregate.mockResolvedValue({ _max: { version: 1 } });
  prisma.researchPlanVersion.create.mockResolvedValue({ id: "plan-version-1" });
  prisma.researchRun.create.mockResolvedValue({ id: "run-1" });
  prisma.researchRun.findUniqueOrThrow.mockResolvedValue({ id: "run-1", status: "planning" });
  createResearchAgentExecution.mockResolvedValue("execution-1");
}

describe("createResearchRun commander model", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.researchWorkspace.findFirst.mockResolvedValue(workspace);
    stubTransaction();
  });

  it("persists the commander model and records every role as run_override in the snapshot", async () => {
    await createResearchRun({ userId: "user-1", workspaceId: "workspace-1", question: "指挥模型生效范围", commanderModel: "qwen3.8-max" });

    const createData = prisma.researchRun.create.mock.calls[0][0].data;
    expect(createData.commanderModel).toBe("qwen3.8-max");
    const configuration = createData.modelConfiguration as Record<string, unknown>;
    const { researchSkills, ...roleConfiguration } = configuration;
    expect(Object.keys(roleConfiguration)).toHaveLength(10);
    expect(researchSkills).toMatchObject({ snapshotVersion: 1, skills: expect.arrayContaining([expect.objectContaining({ skillId: "deep-research-core", version: "1.0.0" })]) });
    for (const [role, rawSelection] of Object.entries(roleConfiguration)) {
      const selection = rawSelection as { model: string; source: string; reasoningEffort: string };
      expect(selection).toMatchObject({ model: "qwen3.8-max", source: "run_override" });
      expect(selection.reasoningEffort).toBe(role === "research.synthesizer" ? "max" : "high");
    }
  });

  it("creates runs without a commander model by default", async () => {
    await createResearchRun({ userId: "user-1", workspaceId: "workspace-1", question: "默认路由保持不变" });

    const createData = prisma.researchRun.create.mock.calls[0][0].data;
    expect(createData.commanderModel).toBeNull();
    const configuration = createData.modelConfiguration as Record<string, unknown>;
    const { researchSkills, ...roleConfiguration } = configuration;
    expect(Object.values(roleConfiguration).every((value) => (value as { source: string }).source === "default")).toBe(true);
    expect(researchSkills).toMatchObject({ snapshotVersion: 1 });
  });

  it("rejects legacy or unknown commander models before touching the database", async () => {
    await expect(createResearchRun({ userId: "user-1", workspaceId: "workspace-1", question: "非法指挥模型", commanderModel: "qwen3.7-plus" }))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(createResearchRun({ userId: "user-1", workspaceId: "workspace-1", question: "非法指挥模型", commanderModel: "unknown-model" }))
      .rejects.toBeInstanceOf(ResearchServiceError);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("updateResearchWorkspace project binding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.researchWorkspace.findFirst.mockResolvedValue({ id: "workspace-1" });
    prisma.researchWorkspace.update.mockResolvedValue({ id: "workspace-1" });
  });

  it("binds a project owned by the current user", async () => {
    prisma.project.findFirst.mockResolvedValue({ id: "project-1" });

    await updateResearchWorkspace({ userId: "user-1", workspaceId: "workspace-1", projectId: "project-1" });

    expect(prisma.project.findFirst).toHaveBeenCalledWith({ where: { id: "project-1", userId: "user-1" }, select: { id: true } });
    expect(prisma.researchWorkspace.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ projectId: "project-1" }) }));
  });

  it("rejects projects that do not belong to the current user", async () => {
    prisma.project.findFirst.mockResolvedValue(null);

    await expect(updateResearchWorkspace({ userId: "user-1", workspaceId: "workspace-1", projectId: "project-foreign" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(prisma.researchWorkspace.update).not.toHaveBeenCalled();
  });

  it("unbinds the project without an ownership lookup", async () => {
    await updateResearchWorkspace({ userId: "user-1", workspaceId: "workspace-1", projectId: null });

    expect(prisma.project.findFirst).not.toHaveBeenCalled();
    expect(prisma.researchWorkspace.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ projectId: null }) }));
  });

  it("rejects workspaces owned by another user", async () => {
    prisma.researchWorkspace.findFirst.mockResolvedValue(null);

    await expect(updateResearchWorkspace({ userId: "user-1", workspaceId: "workspace-1", name: "重命名" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
