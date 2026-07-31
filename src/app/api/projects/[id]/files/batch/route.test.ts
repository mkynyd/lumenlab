import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  projectFindFirst: vi.fn(),
  fileFindMany: vi.fn(),
  fileDeleteMany: vi.fn(),
  fileUpdateMany: vi.fn(),
  deleteChunksByFileAsset: vi.fn(),
  deleteFileAsset: vi.fn(),
  refreshProjectIndex: vi.fn(),
  startFileParseBatch: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({
  prisma: {
    project: { findFirst: mocks.projectFindFirst },
    fileAsset: {
      findMany: mocks.fileFindMany,
      deleteMany: mocks.fileDeleteMany,
      updateMany: mocks.fileUpdateMany,
    },
  },
}));
vi.mock("@/lib/rag/vector-store", () => ({
  deleteChunksByFileAsset: mocks.deleteChunksByFileAsset,
}));
vi.mock("@/lib/rag/project-index", () => ({
  refreshProjectIndex: mocks.refreshProjectIndex,
}));
vi.mock("@/lib/files/parse-job", () => ({
  startFileParseBatch: mocks.startFileParseBatch,
}));
vi.mock("@/lib/files/delete-file-asset", () => ({
  deleteFileAsset: mocks.deleteFileAsset,
}));

import { POST } from "@/app/api/projects/[id]/files/batch/route";

describe("POST /api/projects/[id]/files/batch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.projectFindFirst.mockResolvedValue({ id: "project-1", userId: "user-1", name: "密码学" });
    mocks.fileFindMany.mockResolvedValue([
      {
        id: "file-1",
        userId: "user-1",
        projectId: "project-1",
        originalName: "AES.md",
        textContent: "# AES",
      },
    ]);
    mocks.deleteFileAsset.mockResolvedValue({ deleted: true, id: "file-1" });
    mocks.refreshProjectIndex.mockResolvedValue(undefined);
  });

  it("rejects file ids that do not belong to the project owner", async () => {
    const request = new NextRequest("http://localhost/api/projects/project-1/files/batch", {
      method: "POST",
      body: JSON.stringify({ action: "delete", fileIds: ["file-1", "file-2"] }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ id: "project-1" }),
    });

    expect(response.status).toBe(400);
    expect(mocks.fileDeleteMany).not.toHaveBeenCalled();
  });

  it("returns merged markdown for batch download", async () => {
    const request = new NextRequest("http://localhost/api/projects/project-1/files/batch", {
      method: "POST",
      body: JSON.stringify({ action: "download", fileIds: ["file-1"] }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ id: "project-1" }),
    });

    await expect(response.json()).resolves.toMatchObject({
      filename: expect.stringContaining("密码学_批量导出_"),
      content: expect.stringContaining("# AES.md"),
    });
  });

  it("uses the shared file deletion lifecycle for every selected file", async () => {
    const request = new NextRequest("http://localhost/api/projects/project-1/files/batch", {
      method: "POST",
      body: JSON.stringify({ action: "delete", fileIds: ["file-1"] }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ id: "project-1" }),
    });

    expect(response.status).toBe(200);
    expect(mocks.deleteFileAsset).toHaveBeenCalledWith({
      fileAssetId: "file-1",
      userId: "user-1",
      projectId: "project-1",
      refreshProject: false,
    });
    expect(mocks.fileDeleteMany).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ deleted: 1 });
  });
});
