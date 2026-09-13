import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getResearchWorkspace: vi.fn(),
  updateResearchWorkspace: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/research/service", () => ({
  getResearchWorkspace: mocks.getResearchWorkspace,
  updateResearchWorkspace: mocks.updateResearchWorkspace,
  ResearchServiceError: class ResearchServiceError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message);
    }
  },
}));
vi.mock("@/lib/research/http", () => ({
  researchErrorResponse: (error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "NOT_FOUND") {
      return NextResponse.json({ error: error.message, code: "NOT_FOUND" }, { status: 404 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "研究服务暂时不可用" }, { status: 400 });
  },
}));

import { PATCH } from "./route";
import { ResearchServiceError } from "@/lib/research/service";

function patch(body: unknown) {
  return PATCH(
    new NextRequest("http://localhost/api/research/workspaces/workspace-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "workspace-1" }) }
  );
}

describe("PATCH /api/research/workspaces/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.updateResearchWorkspace.mockResolvedValue({ id: "workspace-1", projectId: "project-1" });
  });

  it("passes a project binding through to the service", async () => {
    const response = await patch({ projectId: "project-1" });

    expect(response.status).toBe(200);
    expect(mocks.updateResearchWorkspace).toHaveBeenCalledWith({ userId: "user-1", workspaceId: "workspace-1", projectId: "project-1" });
  });

  it("supports unbinding the project with null", async () => {
    const response = await patch({ projectId: null });

    expect(response.status).toBe(200);
    expect(mocks.updateResearchWorkspace).toHaveBeenCalledWith({ userId: "user-1", workspaceId: "workspace-1", projectId: null });
  });

  it("maps an ownership rejection from the service to 404", async () => {
    mocks.updateResearchWorkspace.mockRejectedValue(new ResearchServiceError("NOT_FOUND", "项目不存在或无权访问"));

    const response = await patch({ projectId: "project-foreign" });

    expect(response.status).toBe(404);
  });

  it("rejects unknown fields under the strict schema", async () => {
    const response = await patch({ projectId: "project-1", role: "admin" });

    expect(response.status).toBe(400);
    expect(mocks.updateResearchWorkspace).not.toHaveBeenCalled();
  });

  it("rejects empty project ids", async () => {
    const response = await patch({ projectId: "" });

    expect(response.status).toBe(400);
    expect(mocks.updateResearchWorkspace).not.toHaveBeenCalled();
  });
});
