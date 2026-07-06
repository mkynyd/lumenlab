import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseFileContent, parseFileAsset, rewriteAssetReferences } from "../parse-job";
import * as storage from "@/lib/storage/object-storage";
import * as providerAccess from "@/lib/data/provider-access";
import * as minimax from "@/lib/vision/minimax";
import * as mineru from "@/lib/parse/mineru";
import * as minimaxAnalyzer from "@/lib/document-pipeline/vision/minimax-analyzer";
import * as vectorStore from "@/lib/rag/vector-store";
import * as projectIndex from "@/lib/rag/project-index";
import * as embedding from "@/lib/rag/embedding";
import { prisma } from "@/lib/db";

vi.mock("@/lib/storage/object-storage");
vi.mock("@/lib/data/provider-access");
vi.mock("@/lib/vision/minimax");
vi.mock("@/lib/parse/mineru");
vi.mock("@/lib/document-pipeline/vision/minimax-analyzer");
vi.mock("@/lib/rag/vector-store");
vi.mock("@/lib/rag/project-index");
vi.mock("@/lib/rag/embedding");
vi.mock("@/lib/db", () => ({
  prisma: {
    fileAsset: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    fileAssetResource: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    fileParseJob: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

describe("parseFileContent", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(storage.readStoredObject).mockResolvedValue(Buffer.from("content"));
    vi.mocked(providerAccess.getProviderApiKey).mockResolvedValue("key");
    vi.mocked(prisma.fileAsset.update).mockResolvedValue({} as never);
    vi.mocked(minimaxAnalyzer.analyzeImageWithMiniMax).mockResolvedValue({
      summary: "A chart",
      ocrText: "10, 20",
      confidence: 0.9,
      warnings: [],
    });
  });

  it("routes text files to text-local parser", async () => {
    const result = await parseFileContent({
      userId: "u1",
      file: {
        id: "f1",
        originalName: "notes.md",
        mimeType: "text/markdown",
        storageProvider: "local",
        storagePath: "files/f1.md",
        processingMetadata: {},
      },
    });
    expect(result.metadata.parser).toBe("text-local");
    expect(result.metadata.requiresVisionModel).toBe(false);
  });

  it("routes pdf to minimax-m3-pdf parser", async () => {
    vi.mocked(minimax.parseDocumentWithMiniMax).mockResolvedValue("# PDF\n\nText");
    const result = await parseFileContent({
      userId: "u1",
      file: {
        id: "f1",
        originalName: "doc.pdf",
        mimeType: "application/pdf",
        storageProvider: "local",
        storagePath: "files/f1.pdf",
        processingMetadata: {},
      },
    });
    expect(result.metadata.parser).toBe("minimax-m3-pdf");
    expect(result.metadata.requiresVisionModel).toBe(true);
  });

  it("routes office files to mineru-office parser", async () => {
    vi.mocked(mineru.parseFileWithMinerU).mockResolvedValue({
      content: "# Slide",
      assets: [],
      metadata: {
        parser: "mineru-pipeline" as const,
        taskId: "task-1",
        parsedAt: new Date().toISOString(),
      },
    });
    const result = await parseFileContent({
      userId: "u1",
      file: {
        id: "f1",
        originalName: "slides.pptx",
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        storageProvider: "local",
        storagePath: "files/f1.pptx",
        processingMetadata: {},
      },
    });
    expect(result.metadata.parser).toBe("mineru-office");
  });
});

describe("rewriteAssetReferences", () => {
  it("rewrites markdown image references", () => {
    const map = new Map<string, string>([["pics/chart.png", "/api/files/f1/resources/r1"]]);
    const content = "![chart](pics/chart.png)";
    expect(rewriteAssetReferences(content, map)).toBe("![chart](/api/files/f1/resources/r1)");
  });

  it("rewrites html img src references", () => {
    const map = new Map<string, string>([["images/diagram.png", "/api/files/f1/resources/r2"]]);
    const content = '<img src="images/diagram.png" alt="diagram" width="400">';
    expect(rewriteAssetReferences(content, map)).toBe(
      '<img src="/api/files/f1/resources/r2" alt="diagram" width="400">'
    );
  });

  it("rewrites multiple references", () => {
    const map = new Map<string, string>([
      ["a.png", "/api/files/f1/resources/ra"],
      ["b.png", "/api/files/f1/resources/rb"],
    ]);
    const content = "![a](a.png) and <img src=\"b.png\" />";
    expect(rewriteAssetReferences(content, map)).toBe(
      "![a](/api/files/f1/resources/ra) and <img src=\"/api/files/f1/resources/rb\" />"
    );
  });

  it("leaves external urls unchanged", () => {
    const map = new Map<string, string>([["pics/chart.png", "/api/files/f1/resources/r1"]]);
    const content = "![external](https://example.com/img.png) ![local](pics/chart.png)";
    expect(rewriteAssetReferences(content, map)).toBe(
      "![external](https://example.com/img.png) ![local](/api/files/f1/resources/r1)"
    );
  });

  it("leaves anchors unchanged", () => {
    const map = new Map<string, string>([["pics/chart.png", "/api/files/f1/resources/r1"]]);
    const content = "![section](#intro) ![image](pics/chart.png)";
    expect(rewriteAssetReferences(content, map)).toBe(
      "![section](#intro) ![image](/api/files/f1/resources/r1)"
    );
  });

  it("leaves unmapped paths unchanged", () => {
    const map = new Map<string, string>();
    const content = "![other](pics/other.png)";
    expect(rewriteAssetReferences(content, map)).toBe(content);
  });

  it("returns original content when map is empty", () => {
    const content = "![chart](pics/chart.png)";
    expect(rewriteAssetReferences(content, new Map())).toBe(content);
  });

  it("rewrites markdown image references with URL-encoded paths", () => {
    const map = new Map<string, string>([
      ["pics/my chart.png", "/api/files/f1/resources/r1"],
    ]);
    const content = "![chart](pics/my%20chart.png)";
    expect(rewriteAssetReferences(content, map)).toBe(
      "![chart](/api/files/f1/resources/r1)"
    );
  });

  it("rewrites html img src references with URL-encoded paths", () => {
    const map = new Map<string, string>([
      ["images/my diagram.png", "/api/files/f1/resources/r2"],
    ]);
    const content = '<img src="images/my%20diagram.png" alt="diagram">';
    expect(rewriteAssetReferences(content, map)).toBe(
      '<img src="/api/files/f1/resources/r2" alt="diagram">'
    );
  });

  it("rewrites paths with encoded parentheses and brackets", () => {
    const map = new Map<string, string>([
      ["pics/chart (v2) [final].png", "/api/files/f1/resources/r3"],
    ]);
    const content = "![chart](pics/chart%20%28v2%29%20%5Bfinal%5D.png)";
    expect(rewriteAssetReferences(content, map)).toBe(
      "![chart](/api/files/f1/resources/r3)"
    );
  });

  it("rewrites mixed external URLs, anchors, and asset references", () => {
    const map = new Map<string, string>([
      ["pics/my chart.png", "/api/files/f1/resources/r1"],
      ["images/diagram.png", "/api/files/f1/resources/r2"],
    ]);
    const content = [
      "![external](https://example.com/img.png)",
      "![anchor](#section)",
      '![encoded](pics/my%20chart.png)',
      '<img src="images/diagram.png" alt="local">',
    ].join("\n\n");
    expect(rewriteAssetReferences(content, map)).toBe(
      [
        "![external](https://example.com/img.png)",
        "![anchor](#section)",
        "![encoded](/api/files/f1/resources/r1)",
        '<img src="/api/files/f1/resources/r2" alt="local">',
      ].join("\n\n")
    );
  });
});

describe("parseFileAsset", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(storage.readStoredObject).mockResolvedValue(Buffer.from("pptx"));
    vi.mocked(storage.uploadObjectBuffer).mockResolvedValue({
      provider: "local",
      key: "users/u1/file-assets/f1/resources/RESOURCE_ID/filename.png",
    });
    vi.mocked(providerAccess.getProviderApiKey).mockResolvedValue("key");
    vi.mocked(prisma.fileAsset.findFirst).mockResolvedValue({
      id: "f1",
      userId: "u1",
      originalName: "slides.pptx",
      projectId: "p1",
      enhancedContent: null,
      processingMetadata: {},
      status: "parsing",
    } as never);
    vi.mocked(prisma.fileAsset.update).mockResolvedValue({} as never);
    vi.mocked(prisma.fileAssetResource.findMany).mockResolvedValue([]);
    vi.mocked(prisma.fileAssetResource.deleteMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(prisma.fileAssetResource.createMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.fileParseJob.upsert).mockResolvedValue({
      id: "job-1",
      userId: "u1",
      fileAssetId: "f1",
      status: "pending",
      stage: "pending",
      attempt: 0,
    } as never);
    vi.mocked(prisma.fileParseJob.findUnique).mockResolvedValue({
      id: "job-1",
      userId: "u1",
      fileAssetId: "f1",
      status: "pending",
      stage: "pending",
      attempt: 0,
    } as never);
    vi.mocked(prisma.fileParseJob.update).mockResolvedValue({} as never);
    vi.mocked(projectIndex.generateFileIndexMetadata).mockResolvedValue({
      summary: "Summary",
      keywords: ["a", "b"],
    });
    vi.mocked(vectorStore.createDocumentChunks).mockResolvedValue(1);
    vi.mocked(embedding.embedChunksForFile).mockResolvedValue(undefined);
    vi.mocked(projectIndex.refreshProjectIndex).mockResolvedValue("project index");
    vi.mocked(minimaxAnalyzer.analyzeImageWithMiniMax).mockResolvedValue({
      summary: "A chart",
      ocrText: "10, 20",
      confidence: 0.9,
      warnings: [],
    });
  });

  it("rewrites image references after persisting assets", async () => {
    vi.mocked(mineru.parseFileWithMinerU).mockResolvedValue({
      content: "# Slide\n\n![chart](pics/chart.png)",
      assets: [
        {
          relativePath: "pics/chart.png",
          mimeType: "image/png",
          buffer: Buffer.alloc(10_000),
        },
      ],
      metadata: {
        parser: "mineru-pipeline" as const,
        taskId: "task-1",
        parsedAt: new Date().toISOString(),
      },
    });

    await parseFileAsset({ userId: "u1", fileId: "f1" });

    expect(storage.uploadObjectBuffer).toHaveBeenCalledTimes(1);
    expect(prisma.fileAssetResource.createMany).toHaveBeenCalledTimes(1);

    const updateCall = vi.mocked(prisma.fileAsset.update).mock.calls.find(
      (call) => call[0].data && "textContent" in call[0].data
    );
    expect(updateCall).toBeDefined();
    const textContent = (updateCall![0] as { data: { textContent: string } }).data.textContent;
    expect(textContent).not.toContain("pics/chart.png");
    expect(textContent).toContain("/api/files/f1/resources/");

    expect(vectorStore.createDocumentChunks).toHaveBeenCalledWith(
      expect.objectContaining({
        textContent: expect.stringContaining("/api/files/f1/resources/"),
      })
    );

    expect(projectIndex.generateFileIndexMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("/api/files/f1/resources/"),
      })
    );
  });

  it("keeps content unchanged when there are no assets", async () => {
    vi.mocked(mineru.parseFileWithMinerU).mockResolvedValue({
      content: "# Slide\n\nJust text.",
      assets: [],
      metadata: {
        parser: "mineru-pipeline" as const,
        taskId: "task-1",
        parsedAt: new Date().toISOString(),
      },
    });

    await parseFileAsset({ userId: "u1", fileId: "f1" });

    expect(storage.uploadObjectBuffer).not.toHaveBeenCalled();

    const updateCall = vi.mocked(prisma.fileAsset.update).mock.calls.find(
      (call) => call[0].data && "textContent" in call[0].data
    );
    const textContent = (updateCall![0] as { data: { textContent: string } }).data.textContent;
    expect(textContent).toBe("# Slide\n\nJust text.");
  });

  it("delegates failures to the durable job runner without throwing", async () => {
    vi.mocked(mineru.parseFileWithMinerU).mockRejectedValue(new Error("MinerU failed"));

    const result = await parseFileAsset({ userId: "u1", fileId: "f1" });

    expect(result.fileId).toBe("f1");
    expect(prisma.fileParseJob.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { fileAssetId: "f1" },
        create: expect.objectContaining({ status: "pending", stage: "pending" }),
      })
    );
    const failedJobUpdate = vi.mocked(prisma.fileParseJob.update).mock.calls.find(
      (call) => call[0].data && "status" in call[0].data && call[0].data.status === "failed"
    );
    expect(failedJobUpdate).toBeDefined();
    const data = (failedJobUpdate![0] as { data: { error: string } }).data;
    expect(data.error).toContain("MinerU failed");
  });
});
