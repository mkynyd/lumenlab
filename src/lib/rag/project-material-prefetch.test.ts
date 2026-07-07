import { describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { prefetchProjectMaterialForQuickTask } from "./project-material-prefetch";

vi.mock("@/lib/db", () => ({
  prisma: {
    fileAsset: {
      findMany: vi.fn(),
    },
  },
}));

describe("prefetchProjectMaterialForQuickTask", () => {
  it("uses every readable project file when no files are selected", async () => {
    vi.mocked(prisma.fileAsset.findMany).mockResolvedValueOnce([
      {
        id: "file-1",
        originalName: "第一章.md",
        category: "讲义",
        categoryConfidence: 1,
        status: "parsed",
        textContent: "第一章 网络安全基础与安全目标。",
        enhancedContent: null,
        processingMetadata: { summary: "网络安全基础", keywords: ["网络安全"] },
      },
      {
        id: "file-2",
        originalName: "第二章.md",
        category: "讲义",
        categoryConfidence: 1,
        status: "partial",
        textContent: "第二章 威胁建模与风险评估。",
        enhancedContent: null,
        processingMetadata: { summary: "威胁建模", keywords: ["风险评估"] },
      },
      {
        id: "file-3",
        originalName: "解析中.pdf",
        category: "讲义",
        categoryConfidence: 1,
        status: "parsing",
        textContent: null,
        enhancedContent: null,
        processingMetadata: {},
      },
    ] as Awaited<ReturnType<typeof prisma.fileAsset.findMany>>);

    const result = await prefetchProjectMaterialForQuickTask({
      userId: "user-1",
      projectId: "project-1",
      selectedFileIds: [],
      prompt: "生成 Mermaid 逻辑图",
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.selectedOnly).toBe(false);
    expect(result.readableFileCount).toBe(2);
    expect(result.totalCandidateFileCount).toBe(3);
    expect(result.usedFileIds).toEqual(["file-1", "file-2"]);
    expect(result.context).toContain("覆盖范围：当前项目内全部 2 份可读资料");
    expect(result.context).toContain("第一章 网络安全基础");
    expect(result.context).toContain("第二章 威胁建模");
  });

  it("returns a deterministic error when selected files are not readable", async () => {
    vi.mocked(prisma.fileAsset.findMany).mockResolvedValueOnce([
      {
        id: "file-1",
        originalName: "未解析.pdf",
        category: "讲义",
        categoryConfidence: 1,
        status: "parsing",
        textContent: null,
        enhancedContent: null,
        processingMetadata: {},
      },
    ] as Awaited<ReturnType<typeof prisma.fileAsset.findMany>>);

    const result = await prefetchProjectMaterialForQuickTask({
      userId: "user-1",
      projectId: "project-1",
      selectedFileIds: ["file-1"],
      prompt: "提取知识点",
    });

    expect(result).toMatchObject({
      status: "selected_unreadable",
      selectedOnly: true,
      readableFileCount: 0,
    });
  });
});
