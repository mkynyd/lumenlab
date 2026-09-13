import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getResearchWorkspace: vi.fn(),
  createResearchRun: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/research/service", () => ({
  getResearchWorkspace: mocks.getResearchWorkspace,
  createResearchRun: mocks.createResearchRun,
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

import { POST } from "./route";

function post(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/research/workspaces/workspace-1/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "workspace-1" }) }
  );
}

describe("POST /api/research/workspaces/[id]/runs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.createResearchRun.mockResolvedValue({ id: "run-1", status: "planning" });
  });

  it("accepts an active catalog commander model and passes it to the service", async () => {
    const response = await post({ question: "研究问题", commanderModel: "qwen3.8-max" });

    expect(response.status).toBe(201);
    expect(mocks.createResearchRun).toHaveBeenCalledWith({
      userId: "user-1",
      workspaceId: "workspace-1",
      question: "研究问题",
      commanderModel: "qwen3.8-max",
    });
  });

  it("creates runs without a commander model", async () => {
    const response = await post({ question: "研究问题" });

    expect(response.status).toBe(201);
    expect(mocks.createResearchRun).toHaveBeenCalledWith({
      userId: "user-1",
      workspaceId: "workspace-1",
      question: "研究问题",
    });
  });

  it("rejects legacy or unknown commander models with 400", async () => {
    for (const commanderModel of ["qwen3.7-plus", "unknown-model", 42]) {
      const response = await post({ question: "研究问题", commanderModel });
      expect(response.status).toBe(400);
    }
    expect(mocks.createResearchRun).not.toHaveBeenCalled();
  });

  it("rejects unknown fields under the strict schema", async () => {
    const response = await post({ question: "研究问题", temperature: 0.5 });

    expect(response.status).toBe(400);
    expect(mocks.createResearchRun).not.toHaveBeenCalled();
  });
});
