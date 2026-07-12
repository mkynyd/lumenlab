import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  projectFindFirst: vi.fn(),
  fileFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    project: { findFirst: mocks.projectFindFirst },
    fileAsset: { findMany: mocks.fileFindMany },
  },
}));

import {
  ContextAssemblyError,
  PrismaContextAssembler,
} from "./context-assembler";

describe("PrismaContextAssembler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.projectFindFirst.mockResolvedValue({
      id: "project-1",
      userId: "user-1",
      name: "项目",
      type: "general",
      description: null,
    });
    mocks.fileFindMany.mockResolvedValue([]);
  });

  it("deduplicates selected files and derives vision requirements", async () => {
    mocks.fileFindMany.mockResolvedValue([
      {
        id: "file-1",
        originalName: "讲义.pdf",
        mimeType: "application/pdf",
        status: "parsed",
        processingMetadata: { retainedImageCount: 2 },
      },
    ]);

    const result = await new PrismaContextAssembler().assemble({
      userId: "user-1",
      projectId: "project-1",
      selectedFileIds: ["file-1", "file-1"],
    });

    expect(result.selectedFileIds).toEqual(["file-1"]);
    expect(result.requiresVisionModel).toBe(true);
    expect(mocks.fileFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ["file-1"] },
          userId: "user-1",
          projectId: "project-1",
        }),
      })
    );
  });

  it("rejects selected files outside a project", async () => {
    await expect(
      new PrismaContextAssembler().assemble({
        userId: "user-1",
        selectedFileIds: ["file-1"],
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<ContextAssemblyError>>({
        status: 400,
        message: "选择文件时必须提供项目 ID",
      })
    );
  });
});
