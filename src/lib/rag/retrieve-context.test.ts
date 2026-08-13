import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fileFindMany: vi.fn(),
  chunkFindMany: vi.fn(),
  chunkCount: vi.fn(),
  queryRawUnsafe: vi.fn(),
  projectIndexFindUnique: vi.fn(),
  getProviderApiKey: vi.fn(),
  createTextMessage: vi.fn(),
  loadQueryEmbedding: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    fileAsset: { findMany: mocks.fileFindMany },
    documentChunk: {
      count: mocks.chunkCount,
      findMany: mocks.chunkFindMany,
    },
    projectIndex: { findUnique: mocks.projectIndexFindUnique },
    $queryRawUnsafe: mocks.queryRawUnsafe,
  },
}));

vi.mock("@/lib/data/provider-access", () => ({
  getProviderApiKey: mocks.getProviderApiKey,
}));

vi.mock("@/lib/deepseek", () => ({
  createTextMessage: mocks.createTextMessage,
}));

vi.mock("@/lib/redis", () => ({
  getRedis: () => ({
    get: vi.fn().mockResolvedValue(null),
    setex: vi.fn().mockResolvedValue("OK"),
    incr: vi.fn().mockResolvedValue(1),
    mget: vi.fn().mockResolvedValue([]),
  }),
}));

import {
  hybridSearch,
  retrieveProjectContext,
  searchChunksByKeyword,
  shouldUseProjectContext,
} from "@/lib/rag/vector-store";

describe("shouldUseProjectContext", () => {
  it("forceProjectContext 为 true 时直接返回 true", () => {
    expect(shouldUseProjectContext("你好", [], true)).toBe(true);
  });

  it("无 force、无选中、无关键词时返回 false", () => {
    expect(shouldUseProjectContext("你好", [], false)).toBe(false);
  });
});

describe("retrieveProjectContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.chunkCount.mockResolvedValue(1);
    mocks.chunkFindMany.mockResolvedValue([]);
    mocks.queryRawUnsafe.mockResolvedValue([]);
    mocks.projectIndexFindUnique.mockResolvedValue({
      content: [
        "## 项目文件索引",
        "- **实验报告.md** [parsed]",
        "  - ID: file-1",
        "  - 摘要：实验报告资料",
      ].join("\n"),
    });
    mocks.getProviderApiKey.mockRejectedValue(new Error("no provider"));
    mocks.createTextMessage.mockResolvedValue("[]");
    mocks.loadQueryEmbedding.mockResolvedValue([0.1, 0.2, 0.3]);
  });

  it("prefers enhanced content from selected files and identifies its source", async () => {
    mocks.fileFindMany.mockResolvedValue([
      {
        id: "file-1",
        originalName: "课件.png",
        mimeType: "image/png",
        status: "parsed",
        textContent: "OCR 原文",
        enhancedContent: "增强后的资料",
        enhancementStatus: "enhanced",
        processingMetadata: { parser: "minimax-image" },
      },
    ]);
    mocks.chunkFindMany.mockResolvedValue([]);

    const result = await retrieveProjectContext({
      userId: "user-1",
      projectId: "project-1",
      selectedFileIds: ["file-1"],
      query: "资料内容",
      maxChars: 1000,
    });

    expect(result.context).toContain("增强后的资料");
    expect(result.context).toContain("基于 OCR 原文整理的增强资料");
    expect(result.usedFileIds).toEqual(["file-1"]);
  });

  it("loads selected small files directly only for explicit whole-document tasks", async () => {
    mocks.fileFindMany.mockResolvedValue([
      {
        id: "file-1",
        originalName: "实验报告.md",
        mimeType: "text/markdown",
        status: "parsed",
        textContent: "实验目的：验证缓存命中率。\n实验步骤：记录请求。",
        enhancedContent: null,
        enhancementStatus: "none",
        processingMetadata: { parser: "text-local" },
      },
    ]);

    const result = await retrieveProjectContext({
      userId: "user-1",
      projectId: "project-1",
      selectedFileIds: ["file-1"],
      query: "请总结整份文件",
      maxChars: 60000,
      loadQueryEmbedding: mocks.loadQueryEmbedding,
    });

    expect(result.context).toContain("实验目的：验证缓存命中率");
    expect(result.debug.strategy).toBe("full_document");
    expect(result.debug.generatedQueryEmbedding).toBe(false);
    expect(mocks.loadQueryEmbedding).not.toHaveBeenCalled();
  });

  it("uses chunk retrieval instead of full text for selected long-file question answering", async () => {
    const longText = `全文段落 ${"不应整体注入。".repeat(900)}`;
    mocks.fileFindMany.mockResolvedValue([
      {
        id: "file-long",
        originalName: "长课件.md",
        mimeType: "text/markdown",
        status: "parsed",
        textContent: longText,
        enhancedContent: null,
        enhancementStatus: "none",
        processingMetadata: { parser: "text-local" },
      },
    ]);
    mocks.chunkFindMany.mockResolvedValue([
      {
        id: "chunk-keyword",
        content: "命中片段：LRU 缓存通过最近使用顺序淘汰。",
        title: "长课件.md",
        fileAssetId: "file-long",
        projectId: "project-1",
        chunkIndex: 4,
        fileAsset: { originalName: "长课件.md" },
      },
    ]);

    const result = await retrieveProjectContext({
      userId: "user-1",
      projectId: "project-1",
      selectedFileIds: ["file-long"],
      query: "LRU 缓存怎么淘汰？",
      maxChars: 60000,
      loadQueryEmbedding: mocks.loadQueryEmbedding,
    });

    expect(result.context).toContain("命中片段：LRU 缓存");
    expect(result.context).not.toContain("全文段落");
    expect(result.debug.strategy).toBe("keyword_search");
    expect(result.debug.fullDocumentChars).toBe(0);
    expect(mocks.loadQueryEmbedding).not.toHaveBeenCalled();
  });

  it("uses hybrid search for selected multi-file cross-document questions and ranks chunks before full text", async () => {
    mocks.fileFindMany.mockResolvedValue([
      {
        id: "file-a",
        originalName: "A.md",
        mimeType: "text/markdown",
        status: "parsed",
        textContent: "A 文件全文不应排在检索片段前。",
        enhancedContent: null,
        enhancementStatus: "none",
        processingMetadata: { parser: "text-local" },
      },
      {
        id: "file-b",
        originalName: "B.md",
        mimeType: "text/markdown",
        status: "parsed",
        textContent: "B 文件全文不应排在检索片段前。",
        enhancedContent: null,
        enhancementStatus: "none",
        processingMetadata: { parser: "text-local" },
      },
    ]);
    mocks.queryRawUnsafe.mockResolvedValue([
      {
        id: "chunk-vector",
        content: "向量命中片段：两份材料都讨论缓存与检索。",
        title: "A.md",
        fileAssetId: "file-a",
        projectId: "project-1",
        chunkIndex: 1,
        distance: 0.1,
      },
    ]);
    mocks.chunkFindMany.mockResolvedValue([
      {
        id: "chunk-vector",
        content: "向量命中片段：两份材料都讨论缓存与检索。",
        title: "A.md",
        fileAssetId: "file-a",
        projectId: "project-1",
        chunkIndex: 1,
        fileAsset: { originalName: "A.md" },
      },
    ]);

    const result = await retrieveProjectContext({
      userId: "user-1",
      projectId: "project-1",
      selectedFileIds: ["file-a", "file-b"],
      query: "比较两份材料中缓存和检索的关系",
      maxChars: 60000,
      loadQueryEmbedding: mocks.loadQueryEmbedding,
    });

    expect(result.debug.strategy).toBe("hybrid_search");
    expect(result.debug.generatedQueryEmbedding).toBe(true);
    expect(result.context).toContain("向量命中片段");
    expect(result.context).not.toContain("A 文件全文");
  });

  it("uses keyword search without query embedding for explicit chapter queries", async () => {
    mocks.fileFindMany.mockResolvedValue([
      {
        id: "file-1",
        originalName: "操作系统.md",
        mimeType: "text/markdown",
        status: "parsed",
        textContent: "第 3 章 进程调度全文不应整体注入。",
        enhancedContent: null,
        enhancementStatus: "none",
        processingMetadata: { parser: "text-local" },
      },
    ]);
    mocks.chunkFindMany.mockResolvedValue([
      {
        id: "chunk-chapter",
        content: "第 3 章：进程调度包含 FCFS、SJF 和 RR。",
        title: "操作系统.md",
        fileAssetId: "file-1",
        projectId: "project-1",
        chunkIndex: 2,
        fileAsset: { originalName: "操作系统.md" },
      },
    ]);

    const result = await retrieveProjectContext({
      userId: "user-1",
      projectId: "project-1",
      selectedFileIds: ["file-1"],
      query: "第 3 章讲了什么？",
      maxChars: 60000,
      loadQueryEmbedding: mocks.loadQueryEmbedding,
    });

    expect(result.debug.strategy).toBe("keyword_search");
    expect(result.context).toContain("第 3 章：进程调度");
    expect(mocks.loadQueryEmbedding).not.toHaveBeenCalled();
  });

  it("searches project chunks when no files are selected but the user asks to use project materials", async () => {
    mocks.fileFindMany.mockResolvedValue([]);
    mocks.chunkFindMany.mockResolvedValue([
      {
        id: "chunk-project",
        content: "项目资料命中片段：实验使用 Redis 作为应用缓存。",
        title: "缓存实验.md",
        fileAssetId: "file-2",
        projectId: "project-1",
        chunkIndex: 0,
        fileAsset: { originalName: "缓存实验.md" },
      },
    ]);

    const result = await retrieveProjectContext({
      userId: "user-1",
      projectId: "project-1",
      selectedFileIds: [],
      query: "根据项目资料说明缓存实验怎么做",
      maxChars: 60000,
      loadQueryEmbedding: mocks.loadQueryEmbedding,
    });

    expect(result.context).toContain("项目资料命中片段");
    expect(result.debug.candidateFileCount).toBeGreaterThanOrEqual(0);
    expect(result.debug.matchedChunkCount).toBe(1);
  });

  it("uses all parsed courseware instead of agentic narrowing for corpus-wide knowledge extraction", async () => {
    mocks.chunkCount.mockResolvedValue(25);
    mocks.fileFindMany.mockResolvedValueOnce([
      {
        id: "file-1",
        originalName: "1-1 电路模型.ppt",
        mimeType: "application/pdf",
        status: "parsed",
        textContent: "开头内容。知识点：电路模型与参考方向。" + "中间段落。".repeat(400) + "结尾内容：本章总结。",
        enhancedContent: null,
        enhancementStatus: "none",
        processingMetadata: null,
      },
      {
        id: "file-2",
        originalName: "2-1 等效变换.ppt",
        mimeType: "application/pdf",
        status: "parsed",
        textContent: "知识点：等效变换与电源变换。",
        enhancedContent: null,
        enhancementStatus: "none",
        processingMetadata: null,
      },
      {
        id: "file-3",
        originalName: "3-1 电容.ppt",
        mimeType: "application/pdf",
        status: "parsed",
        textContent: "知识点：电容元件与动态响应。",
        enhancedContent: null,
        enhancementStatus: "none",
        processingMetadata: null,
      },
    ]);

    const result = await retrieveProjectContext({
      userId: "user-1",
      projectId: "project-1",
      selectedFileIds: [],
      query: "请基于我选中的资料提取核心知识点，按章节和依赖关系组织，标注重点、难点和易混点。",
      maxChars: 60000,
      loadQueryEmbedding: mocks.loadQueryEmbedding,
    });

    expect(mocks.createTextMessage).not.toHaveBeenCalled();
    expect(result.debug.scopeSource).toBe("project");
    expect(result.debug.candidateFileCount).toBe(3);
    expect(result.debug.matchedChunkCount).toBe(3);
    expect(result.context).toContain("1-1 电路模型.ppt");
    expect(result.context).toContain("2-1 等效变换.ppt");
    // 长文档的尾段采样必须进入上下文(修复此前只读第一个 chunk 的问题)
    expect(result.context).toContain("本章总结");
    expect(result.context).toContain("3-1 电容.ppt");
  });

  it("does not generate query embedding when the scoped project has no searchable chunks", async () => {
    mocks.chunkCount.mockResolvedValue(0);
    mocks.fileFindMany.mockResolvedValue([
      {
        id: "file-a",
        originalName: "A.md",
        mimeType: "text/markdown",
        status: "parsed",
        textContent: "A 文件内容",
        enhancedContent: null,
        enhancementStatus: "none",
        processingMetadata: { parser: "text-local" },
      },
      {
        id: "file-b",
        originalName: "B.md",
        mimeType: "text/markdown",
        status: "parsed",
        textContent: "B 文件内容",
        enhancedContent: null,
        enhancementStatus: "none",
        processingMetadata: { parser: "text-local" },
      },
    ]);

    const result = await retrieveProjectContext({
      userId: "user-1",
      projectId: "project-1",
      selectedFileIds: ["file-a", "file-b"],
      query: "比较两份材料的共同点",
      maxChars: 60000,
      loadQueryEmbedding: mocks.loadQueryEmbedding,
    });

    expect(result.debug.strategy).toBe("hybrid_search");
    expect(result.debug.generatedQueryEmbedding).toBe(false);
    expect(mocks.loadQueryEmbedding).not.toHaveBeenCalled();
  });

  it("does not fall back to project-wide search when selected files are not parsed", async () => {
    mocks.fileFindMany.mockResolvedValue([
      {
        id: "file-failed",
        originalName: "失败文件.pdf",
        mimeType: "application/pdf",
        status: "failed",
        textContent: null,
        enhancedContent: null,
        enhancementStatus: "none",
        processingMetadata: { parseError: "failed" },
      },
    ]);

    const result = await retrieveProjectContext({
      userId: "user-1",
      projectId: "project-1",
      selectedFileIds: ["file-failed"],
      query: "比较这份材料和项目资料",
      maxChars: 60000,
      loadQueryEmbedding: mocks.loadQueryEmbedding,
    });

    expect(result.context).toBe("");
    expect(result.debug.matchedChunkCount).toBe(0);
    expect(mocks.chunkFindMany).not.toHaveBeenCalled();
    expect(mocks.loadQueryEmbedding).not.toHaveBeenCalled();
  });

  it("returns a Chinese notice when no project material matches", async () => {
    mocks.fileFindMany.mockResolvedValue([]);
    mocks.chunkFindMany.mockResolvedValue([]);

    const result = await retrieveProjectContext({
      userId: "user-1",
      projectId: "project-1",
      selectedFileIds: [],
      query: "不存在的内容",
      maxChars: 1000,
    });

    expect(result.context).toBe("");
    expect(result.notice).toBe("未找到可用于回答的项目资料。");
  });
});

describe("hybridSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queryRawUnsafe.mockResolvedValue([]);
    mocks.chunkFindMany.mockResolvedValue([]);
  });

  it("merges vector and keyword rankings with RRF", async () => {
    mocks.queryRawUnsafe.mockResolvedValue([
      {
        id: "vector-only",
        content: "向量结果",
        title: "A.md",
        fileAssetId: "file-a",
        projectId: "project-1",
        chunkIndex: 0,
        distance: 0.1,
      },
      {
        id: "shared",
        content: "共同结果",
        title: "B.md",
        fileAssetId: "file-b",
        projectId: "project-1",
        chunkIndex: 1,
        distance: 0.2,
      },
    ]);
    mocks.chunkFindMany
      .mockResolvedValueOnce([
        {
          id: "keyword-only",
          content: "关键词结果",
          title: "C.md",
          fileAssetId: "file-c",
          projectId: "project-1",
          chunkIndex: 2,
          fileAsset: { originalName: "C.md" },
        },
        {
          id: "shared",
          content: "共同结果",
          title: "B.md",
          fileAssetId: "file-b",
          projectId: "project-1",
          chunkIndex: 1,
          fileAsset: { originalName: "B.md" },
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "vector-only",
          content: "向量结果",
          title: "A.md",
          fileAssetId: "file-a",
          projectId: "project-1",
          chunkIndex: 0,
          fileAsset: { originalName: "A.md" },
        },
        {
          id: "keyword-only",
          content: "关键词结果",
          title: "C.md",
          fileAssetId: "file-c",
          projectId: "project-1",
          chunkIndex: 2,
          fileAsset: { originalName: "C.md" },
        },
        {
          id: "shared",
          content: "共同结果",
          title: "B.md",
          fileAssetId: "file-b",
          projectId: "project-1",
          chunkIndex: 1,
          fileAsset: { originalName: "B.md" },
        },
      ]);

    const result = await hybridSearch({
      userId: "user-1",
      projectId: "project-1",
      query: "比较缓存策略",
      queryEmbedding: Array.from({ length: 1024 }, () => 0.1),
      limit: 3,
    });

    expect(mocks.queryRawUnsafe).toHaveBeenCalledOnce();
    expect(result.map((chunk) => chunk.id)).toEqual([
      "shared",
      "vector-only",
      "keyword-only",
    ]);
  });

  it("ranks keyword chunks by hit-count scoring instead of file order", async () => {
    mocks.chunkFindMany.mockResolvedValueOnce([
      {
        id: "chunk-few",
        content: "缓存策略",
        title: "B.md",
        fileAssetId: "file-b",
        projectId: "project-1",
        chunkIndex: 1,
        fileAsset: { originalName: "B.md" },
      },
      {
        id: "chunk-many",
        content: "缓存策略 缓存策略 缓存策略 缓存策略",
        title: "A.md",
        fileAssetId: "file-a",
        projectId: "project-1",
        chunkIndex: 0,
        fileAsset: { originalName: "A.md" },
      },
    ]);

    const result = await searchChunksByKeyword({
      userId: "user-1",
      projectId: "project-1",
      query: "缓存策略",
      limit: 2,
    });

    // 命中次数多者排在前面,与文件序(chunk-few 在前)无关
    expect(result.map((chunk) => chunk.id)).toEqual([
      "chunk-many",
      "chunk-few",
    ]);
  });
});
