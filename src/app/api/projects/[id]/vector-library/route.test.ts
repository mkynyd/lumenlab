// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  fileFindMany: vi.fn(),
  chunkFindMany: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({
  prisma: {
    fileAsset: { findMany: mocks.fileFindMany },
    documentChunk: { findMany: mocks.chunkFindMany },
  },
}));

import { GET } from "@/app/api/projects/[id]/vector-library/route";

const context = { params: Promise.resolve({ id: "project-1" }) };

describe("vector-library route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.fileFindMany.mockResolvedValue([
      {
        id: "f1",
        userId: "user-1",
        projectId: "project-1",
        originalName: "电路.md",
        filename: "a.md",
        mimeType: "text/markdown",
        size: 10,
        status: "parsed",
        category: null,
        categoryConfidence: null,
        enhancementStatus: "none",
        processingMetadata: null,
        processingError: null,
        createdAt: "2026-01-01T00:00:00Z",
      },
    ]);
    mocks.chunkFindMany.mockResolvedValue([
      {
        id: "c1",
        fileAssetId: "f1",
        content: "电阻电容电路",
        chunkIndex: 0,
        tokenCount: 5,
      },
    ]);
  });

  it("returns graph with file and chunk nodes", async () => {
    const response = await GET(new Request("http://localhost"), context);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.graph.stats.fileCount).toBe(1);
    expect(body.graph.stats.chunkCount).toBe(1);
    expect(body.graph.nodes.some((n: { type: string }) => n.type === "file")).toBe(true);
    expect(body.graph.nodes.some((n: { type: string }) => n.type === "chunk")).toBe(true);
  });

  it("rejects unauthenticated requests", async () => {
    mocks.auth.mockResolvedValue(null);
    const response = await GET(new Request("http://localhost"), context);
    expect(response.status).toBe(401);
  });
});
