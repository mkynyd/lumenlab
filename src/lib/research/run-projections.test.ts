import { beforeEach, describe, expect, it, vi } from "vitest";

const { findFirst, queryRaw } = vi.hoisted(() => ({ findFirst: vi.fn(), queryRaw: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { researchRun: { findFirst }, $queryRaw: queryRaw } }));

import { getResearchRun, getResearchRunAssets, getResearchRunReport } from "./service";

describe("Research run projections", () => {
  beforeEach(() => vi.clearAllMocks());

  it("polls only public status, not the checkpoint or heavy collections", async () => {
    findFirst.mockResolvedValue({
      id: "run-1", status: "researching", metrics: {}, tasks: [], agentExecution: { id: "execution-1", status: "running" },
      _count: { sourceSnapshots: 0, evidence: 0, claims: 0 },
    });
    queryRaw.mockResolvedValue([{ stage: "citation_expansion", degradations: [] }]);
    const result = await getResearchRun("owner-1", "run-1");
    const query = findFirst.mock.calls[0][0];
    expect(query.where).toEqual({ id: "run-1", userId: "owner-1" });
    expect(query.select.agentExecution.select).not.toHaveProperty("checkpoint");
    expect(query.select).not.toHaveProperty("evidence");
    expect(query.select).not.toHaveProperty("claims");
    expect(query.select).not.toHaveProperty("reportSnapshot");
    expect(query.select).not.toHaveProperty("sourceRelations");
    expect(result.stage).toMatchObject({ key: "citation_expansion" });
    expect(queryRaw).toHaveBeenCalledOnce();
  });

  it("loads the report without frozen claim snapshots and model prompts", async () => {
    findFirst.mockResolvedValue({ reportSnapshot: { reportDocument: { body: "report" } } });
    await expect(getResearchRunReport("owner-1", "run-1")).resolves.toMatchObject({ reportDocument: { body: "report" } });
    const query = findFirst.mock.calls[0][0];
    expect(query.where).toEqual({ id: "run-1", userId: "owner-1" });
    expect(query.select.reportSnapshot.select).not.toHaveProperty("claimSnapshots");
    expect(query.select.reportSnapshot.select).not.toHaveProperty("modelConfiguration");
  });

  it("bounds drill-down results and denies missing or unowned runs", async () => {
    findFirst.mockResolvedValueOnce({ evidence: [], claims: [], sourceRelations: [] }).mockResolvedValueOnce(null);
    await getResearchRunAssets("owner-1", "run-1");
    const query = findFirst.mock.calls[0][0];
    expect(query.where).toEqual({ id: "run-1", userId: "owner-1" });
    expect(query.select.evidence.take).toBe(200);
    expect(query.select.claims.take).toBe(100);
    await expect(getResearchRunAssets("other-user", "run-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
