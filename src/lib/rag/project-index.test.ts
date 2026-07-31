import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  projectFindFirst: vi.fn(),
  fileFindMany: vi.fn(),
  projectIndexUpsert: vi.fn(),
  projectIndexFindUnique: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    project: { findFirst: mocks.projectFindFirst },
    fileAsset: { findMany: mocks.fileFindMany },
    projectIndex: {
      upsert: mocks.projectIndexUpsert,
      findUnique: mocks.projectIndexFindUnique,
    },
  },
}));

import {
  matchProjectIndex,
  refreshProjectIndex,
} from "@/lib/rag/project-index";

describe("project index", () => {
  it("stores one markdown line per file with category, summary, terms, and status", async () => {
    mocks.projectFindFirst.mockResolvedValue({ id: "project-1", userId: "user-1" });
    mocks.fileFindMany.mockResolvedValue([
      {
        id: "file-1",
        originalName: "AES 期末试卷.pdf",
        category: "试卷",
        categoryConfidence: 0.9,
        status: "parsed",
        textContent: "AES 轮函数 SubBytes ShiftRows MixColumns 试题",
        enhancedContent: null,
      },
    ]);
    mocks.projectIndexUpsert.mockResolvedValue({});

    const content = await refreshProjectIndex({
      userId: "user-1",
      projectId: "project-1",
    });

    expect(content).toContain("AES 期末试卷.pdf");
    expect(content).toContain("分类：试卷");
    expect(content).toContain("状态：parsed");
    expect(content).toContain("关键术语：");
    expect(mocks.projectIndexUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: "project-1" },
      })
    );
  });

  it("ranks exact filename matches ahead of keyword matches and caps full-load results", async () => {
    mocks.projectFindFirst.mockResolvedValue({ id: "project-1", userId: "user-1" });
    mocks.fileFindMany.mockResolvedValue([
      {
        id: "file-1",
        originalName: "AES 期末试卷.pdf",
        category: "试卷",
        categoryConfidence: 0.95,
        status: "parsed",
        textContent: "分组密码 AES S 盒",
        enhancedContent: null,
      },
      ...Array.from({ length: 7 }, (_, index) => ({
        id: `file-${index + 2}`,
        originalName: `AES 课件 ${index + 1}.pdf`,
        category: "课件",
        categoryConfidence: 0.8,
        status: "parsed",
        textContent: "AES 分组密码 工作模式",
        enhancedContent: null,
      })),
    ]);

    const result = await matchProjectIndex({
      userId: "user-1",
      projectId: "project-1",
      query: "请分析 AES 期末试卷.pdf 的分组密码题",
      limit: 5,
    });

    expect(result.fullLoadFileIds).toHaveLength(5);
    expect(result.fullLoadFileIds[0]).toBe("file-1");
    expect(result.summaryOnly).toHaveLength(3);
  });

  it("indexes OCR text instead of a stale enhanced version", async () => {
    mocks.projectFindFirst.mockResolvedValue({ id: "project-1", userId: "user-1" });
    mocks.fileFindMany.mockResolvedValue([
      {
        id: "file-1",
        originalName: "修订讲义.md",
        category: "讲义",
        categoryConfidence: 1,
        status: "parsed",
        textContent: "current-ocr-token",
        enhancedContent: "obsolete-enhanced-token",
        enhancementStatus: "stale",
        processingMetadata: {},
      },
    ]);
    mocks.projectIndexUpsert.mockResolvedValue({});

    const content = await refreshProjectIndex({
      userId: "user-1",
      projectId: "project-1",
    });

    expect(content).toContain("current-ocr-token");
    expect(content).not.toContain("obsolete-enhanced-token");
  });
});
