// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";
import { DocumentPipeline } from "../pipeline";
import * as minimaxAnalyzer from "../vision/minimax-analyzer";
import * as qwenAnalyzer from "../vision/qwen-analyzer";
import * as mineru from "@/lib/parse/mineru";
import * as minimax from "@/lib/vision/minimax";

vi.mock("../vision/minimax-analyzer");
vi.mock("../vision/qwen-analyzer");
vi.mock("@/lib/parse/mineru");
vi.mock("@/lib/vision/minimax", () => {
  class MiniMaxError extends Error {
    constructor(public status: number, message: string) {
      super(message);
      this.name = "MiniMaxError";
    }
  }
  return {
    MiniMaxError,
    mapAnthropicErrorToMiniMaxError: vi.fn(),
    parseImageWithMiniMax: vi.fn(),
    parseDocumentWithMiniMax: vi.fn(),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

function makeInput(
  filename: string,
  mimeType: string,
  data: Buffer,
  apiKeys: { minimax?: string; mineru?: string; bailian?: string } = {}
) {
  return {
    userId: "u1",
    fileAssetId: "f1",
    filename,
    mimeType,
    data,
    apiKeys,
  };
}

describe("DocumentPipeline", () => {
  it("parses a text file without vision", async () => {
    const pipeline = new DocumentPipeline();
    const result = await pipeline.run(makeInput("note.md", "text/markdown", Buffer.from("Hello world")));

    expect(result.content).toBe("Hello world");
    expect(result.status).toBe("parsed");
    expect(result.metadata.requiresVisionModel).toBe(false);
    expect(result.assets).toHaveLength(0);
    expect(minimaxAnalyzer.analyzeImageWithMiniMax).not.toHaveBeenCalled();
  });

  it("orchestrates image analysis for office documents when minimax key is present", async () => {
    vi.mocked(mineru.parseFileWithMinerU).mockResolvedValue({
      content: "# Slide 1\n\n![chart](pics/chart.png)",
      assets: [
        {
          relativePath: "pics/chart.png",
          mimeType: "image/png",
          buffer: Buffer.alloc(10_000),
        },
      ],
      metadata: {
        parser: "mineru-pipeline",
        taskId: "task-1",
        parsedAt: new Date().toISOString(),
      },
    });

    vi.mocked(minimaxAnalyzer.analyzeImageWithMiniMax).mockResolvedValue({
      summary: "A bar chart",
      ocrText: "10, 20",
      confidence: 0.9,
      warnings: [],
    });

    const pipeline = new DocumentPipeline();
    const result = await pipeline.run(
      makeInput("slides.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation", Buffer.from("pptx"), {
        minimax: "sk-minimax",
        mineru: "token",
      })
    );

    expect(result.metadata.parser).toBe("mineru-office");
    expect(result.metadata.requiresVisionModel).toBe(true);

    const image = result.blocks.find((b) => b.type === "image") as Extract<
      typeof result.blocks[number],
      { type: "image" }
    >;
    expect(image).toBeDefined();
    expect(image.analysisStatus).toBe("parsed");
    expect(image.visionSummary).toBe("A bar chart");
    expect(image.visionText).toBe("10, 20");
    expect(image.confidence).toBe(0.9);

    expect(minimaxAnalyzer.analyzeImageWithMiniMax).toHaveBeenCalledTimes(1);
    const call = vi.mocked(minimaxAnalyzer.analyzeImageWithMiniMax).mock.calls[0][0];
    expect(call.apiKey).toBe("sk-minimax");
    const asset = result.assets[0];
    expect(call.image).toEqual({
      type: "base64",
      mediaType: asset.mimeType,
      data: asset.buffer,
    });
    expect(call.mode).toBe("chart");

    expect(result.content).toContain("A bar chart");
    expect(result.content).toContain("10, 20");
  });

  it("throws for unsupported file types", async () => {
    const pipeline = new DocumentPipeline();
    await expect(
      pipeline.run(makeInput("song.mp3", "audio/mpeg", Buffer.from("mp3")))
    ).rejects.toThrow("不支持的文件类型: .mp3");
  });

  it("continues parsing when vision analysis fails", async () => {
    vi.mocked(mineru.parseFileWithMinerU).mockResolvedValue({
      content: "![chart](pics/chart.png)",
      assets: [
        {
          relativePath: "pics/chart.png",
          mimeType: "image/png",
          buffer: Buffer.alloc(10_000),
        },
      ],
      metadata: {
        parser: "mineru-pipeline",
        taskId: "task-1",
        parsedAt: new Date().toISOString(),
      },
    });

    vi.mocked(minimaxAnalyzer.analyzeImageWithMiniMax).mockRejectedValue(
      new Error("MiniMax vision error")
    );

    const pipeline = new DocumentPipeline();
    const result = await pipeline.run(
      makeInput(
        "slides.pptx",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        Buffer.from("pptx"),
        { minimax: "sk-minimax", mineru: "token" }
      )
    );

    expect(result.status).toBe("parsed");
    const image = result.blocks.find((b) => b.type === "image") as Extract<
      typeof result.blocks[number],
      { type: "image" }
    >;
    expect(image).toBeDefined();
    expect(image.analysisStatus).toBe("failed");
    expect(image.skipReason).toBe("MiniMax vision error");
    expect(
      result.metadata.parseWarnings.some((w) => w.includes("分析失败"))
    ).toBe(true);
    expect(minimaxAnalyzer.analyzeImageWithMiniMax).toHaveBeenCalledTimes(1);
  });

  it("analyzes duplicate images only once", async () => {
    vi.mocked(mineru.parseFileWithMinerU).mockResolvedValue({
      content:
        "![chart](pics/chart.png)\n\n![chart again](pics/chart.png)",
      assets: [
        {
          relativePath: "pics/chart.png",
          mimeType: "image/png",
          buffer: Buffer.alloc(10_000),
        },
      ],
      metadata: {
        parser: "mineru-pipeline",
        taskId: "task-1",
        parsedAt: new Date().toISOString(),
      },
    });

    vi.mocked(minimaxAnalyzer.analyzeImageWithMiniMax).mockResolvedValue({
      summary: "A bar chart",
      ocrText: "10, 20",
      confidence: 0.9,
      warnings: [],
    });

    const pipeline = new DocumentPipeline();
    const result = await pipeline.run(
      makeInput(
        "slides.pptx",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        Buffer.from("pptx"),
        { minimax: "sk-minimax", mineru: "token" }
      )
    );

    expect(minimaxAnalyzer.analyzeImageWithMiniMax).toHaveBeenCalledTimes(1);
    const images = result.blocks.filter((b) => b.type === "image") as Extract<
      typeof result.blocks[number],
      { type: "image" }
    >[];
    expect(images).toHaveLength(2);
    expect(images.filter((i) => i.analysisStatus === "parsed")).toHaveLength(1);
    expect(images.filter((i) => i.analysisStatus === "skipped")).toHaveLength(1);
  });

  it("reports progress during image analysis", async () => {
    vi.mocked(mineru.parseFileWithMinerU).mockResolvedValue({
      content: "![chart](pics/chart.png)",
      assets: [
        {
          relativePath: "pics/chart.png",
          mimeType: "image/png",
          buffer: Buffer.alloc(10_000),
        },
      ],
      metadata: {
        parser: "mineru-pipeline",
        taskId: "task-1",
        parsedAt: new Date().toISOString(),
      },
    });

    vi.mocked(minimaxAnalyzer.analyzeImageWithMiniMax).mockResolvedValue({
      summary: "A bar chart",
      ocrText: "10, 20",
      confidence: 0.9,
      warnings: [],
    });

    const onProgress = vi.fn();
    const pipeline = new DocumentPipeline();
    await pipeline.run(
      makeInput(
        "slides.pptx",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        Buffer.from("pptx"),
        { minimax: "sk-minimax", mineru: "token" }
      ),
      onProgress
    );

    expect(onProgress).toHaveBeenCalledWith("analyzing-images", {
      current: 1,
      total: 1,
    });
  });

  it("constructs a base64 image request for MiniMax", async () => {
    vi.mocked(mineru.parseFileWithMinerU).mockResolvedValue({
      content: "![diagram](pics/diagram.png)",
      assets: [
        {
          relativePath: "pics/diagram.png",
          mimeType: "image/png",
          buffer: Buffer.alloc(10_000),
        },
      ],
      metadata: {
        parser: "mineru-pipeline",
        taskId: "task-1",
        parsedAt: new Date().toISOString(),
      },
    });

    vi.mocked(minimaxAnalyzer.analyzeImageWithMiniMax).mockResolvedValue({
      summary: "A diagram",
      ocrText: "node a -> node b",
      confidence: 0.8,
      warnings: [],
    });

    const pipeline = new DocumentPipeline();
    const result = await pipeline.run(
      makeInput(
        "slides.pptx",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        Buffer.from("pptx"),
        { minimax: "sk-minimax", mineru: "token" }
      )
    );

    const asset = result.assets[0];
    const call = vi.mocked(minimaxAnalyzer.analyzeImageWithMiniMax).mock.calls[0][0];
    expect(call.image.type).toBe("base64");
    const base64Image = call.image as Extract<typeof call.image, { type: "base64" }>;
    expect(base64Image.mediaType).toBe(asset.mimeType);
    expect(base64Image.data).toBe(asset.buffer);
  });

  it("routes PDFs above the MiniMax size limit to MinerU", async () => {
    vi.mocked(mineru.parseFileWithMinerU).mockResolvedValue({
      content: "# Big PDF",
      assets: [],
      metadata: {
        parser: "mineru-pipeline",
        taskId: "task-big",
        parsedAt: new Date().toISOString(),
      },
    });

    const pipeline = new DocumentPipeline();
    const result = await pipeline.run(
      makeInput("big.pdf", "application/pdf", Buffer.alloc(21 * 1024 * 1024), {
        minimax: "sk-minimax",
        mineru: "token",
      })
    );

    expect(mineru.parseFileWithMinerU).toHaveBeenCalledTimes(1);
    expect(minimax.parseDocumentWithMiniMax).not.toHaveBeenCalled();
    expect(result.metadata.parser).toBe("mineru-office");
    expect(result.content).toContain("# Big PDF");
  });

  it("routes PDFs within the MiniMax size limit to MiniMax", async () => {
    vi.mocked(minimax.parseDocumentWithMiniMax).mockResolvedValue("# Small PDF");

    const pipeline = new DocumentPipeline();
    const result = await pipeline.run(
      makeInput("small.pdf", "application/pdf", Buffer.from("pdf"), {
        minimax: "sk-minimax",
        mineru: "token",
      })
    );

    expect(minimax.parseDocumentWithMiniMax).toHaveBeenCalledTimes(1);
    expect(mineru.parseFileWithMinerU).not.toHaveBeenCalled();
    expect(result.metadata.parser).toBe("minimax-m3-pdf");
    expect(result.content).toContain("# Small PDF");
  });

  it("falls back to MinerU when MiniMax rejects an oversized PDF request", async () => {
    vi.mocked(minimax.parseDocumentWithMiniMax).mockRejectedValue(
      new minimax.MiniMaxError(413, "文档或请求体超过 MiniMax 限制")
    );
    vi.mocked(mineru.parseFileWithMinerU).mockResolvedValue({
      content: "# Recovered",
      assets: [],
      metadata: {
        parser: "mineru-pipeline",
        taskId: "task-fallback",
        parsedAt: new Date().toISOString(),
      },
    });

    const pipeline = new DocumentPipeline();
    const result = await pipeline.run(
      makeInput("doc.pdf", "application/pdf", Buffer.from("pdf"), {
        minimax: "sk-minimax",
        mineru: "token",
      })
    );

    expect(minimax.parseDocumentWithMiniMax).toHaveBeenCalledTimes(1);
    expect(mineru.parseFileWithMinerU).toHaveBeenCalledTimes(1);
    expect(result.metadata.parser).toBe("mineru-office");
    expect(result.content).toContain("# Recovered");
    expect(
      result.metadata.parseWarnings.some((w) => w.includes("回退到 MinerU"))
    ).toBe(true);
  });

  it("falls back to MinerU on MiniMax 400 format errors", async () => {
    vi.mocked(minimax.parseDocumentWithMiniMax).mockRejectedValue(
      new minimax.MiniMaxError(400, "MiniMax 文档请求格式无效")
    );
    vi.mocked(mineru.parseFileWithMinerU).mockResolvedValue({
      content: "# Recovered",
      assets: [],
      metadata: {
        parser: "mineru-pipeline",
        taskId: "task-fallback-400",
        parsedAt: new Date().toISOString(),
      },
    });

    const pipeline = new DocumentPipeline();
    const result = await pipeline.run(
      makeInput("doc.pdf", "application/pdf", Buffer.from("pdf"), {
        minimax: "sk-minimax",
        mineru: "token",
      })
    );

    expect(result.metadata.parser).toBe("mineru-office");
    expect(
      result.metadata.parseWarnings.some((w) => w.includes("回退到 MinerU"))
    ).toBe(true);
  });

  it("does not fall back to MinerU for non-size MiniMax errors", async () => {
    vi.mocked(minimax.parseDocumentWithMiniMax).mockRejectedValue(
      new minimax.MiniMaxError(500, "MiniMax 服务异常，请稍后重试")
    );

    const pipeline = new DocumentPipeline();
    await expect(
      pipeline.run(
        makeInput("doc.pdf", "application/pdf", Buffer.from("pdf"), {
          minimax: "sk-minimax",
          mineru: "token",
        })
      )
    ).rejects.toThrow("MiniMax 服务异常");
    expect(mineru.parseFileWithMinerU).not.toHaveBeenCalled();
  });

  it("does not fall back to MinerU without a MinerU token", async () => {
    vi.mocked(minimax.parseDocumentWithMiniMax).mockRejectedValue(
      new minimax.MiniMaxError(413, "文档或请求体超过 MiniMax 限制")
    );

    const pipeline = new DocumentPipeline();
    await expect(
      pipeline.run(
        makeInput("doc.pdf", "application/pdf", Buffer.from("pdf"), {
          minimax: "sk-minimax",
        })
      )
    ).rejects.toThrow("超过 MiniMax 限制");
    expect(mineru.parseFileWithMinerU).not.toHaveBeenCalled();
  });

  it("rejects PDFs above the MinerU 200MB limit with a clear error", async () => {
    const pipeline = new DocumentPipeline();
    await expect(
      pipeline.run(
        makeInput("huge.pdf", "application/pdf", Buffer.alloc(200 * 1024 * 1024 + 1), {
          minimax: "sk-minimax",
          mineru: "token",
        })
      )
    ).rejects.toThrow("PDF 文件超过 200MB 解析上限");
    expect(mineru.parseFileWithMinerU).not.toHaveBeenCalled();
    expect(minimax.parseDocumentWithMiniMax).not.toHaveBeenCalled();
  });

  it("prefers Qwen for image analysis when a bailian key is present", async () => {
    vi.mocked(mineru.parseFileWithMinerU).mockResolvedValue({
      content: "![chart](pics/chart.png)",
      assets: [
        {
          relativePath: "pics/chart.png",
          mimeType: "image/png",
          buffer: Buffer.alloc(10_000),
        },
      ],
      metadata: {
        parser: "mineru-pipeline",
        taskId: "task-qwen",
        parsedAt: new Date().toISOString(),
      },
    });

    vi.mocked(qwenAnalyzer.analyzeImageWithQwen).mockResolvedValue({
      summary: "A bar chart by Qwen",
      ocrText: "10, 20",
      confidence: 0.9,
      warnings: [],
    });

    const pipeline = new DocumentPipeline();
    const result = await pipeline.run(
      makeInput(
        "slides.pptx",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        Buffer.from("pptx"),
        { bailian: "sk-bailian", minimax: "sk-minimax", mineru: "token" }
      )
    );

    expect(qwenAnalyzer.analyzeImageWithQwen).toHaveBeenCalledTimes(1);
    expect(minimaxAnalyzer.analyzeImageWithMiniMax).not.toHaveBeenCalled();
    const call = vi.mocked(qwenAnalyzer.analyzeImageWithQwen).mock.calls[0][0];
    expect(call.apiKey).toBe("sk-bailian");
    expect(call.image.type).toBe("base64");
    expect(call.mode).toBe("chart");

    const image = result.blocks.find((b) => b.type === "image") as Extract<
      typeof result.blocks[number],
      { type: "image" }
    >;
    expect(image.analysisStatus).toBe("parsed");
    expect(image.visionSummary).toBe("A bar chart by Qwen");
  });

  it("runs image analysis with MiniMax when only the minimax key is present", async () => {
    vi.mocked(mineru.parseFileWithMinerU).mockResolvedValue({
      content: "![chart](pics/chart.png)",
      assets: [
        {
          relativePath: "pics/chart.png",
          mimeType: "image/png",
          buffer: Buffer.alloc(10_000),
        },
      ],
      metadata: {
        parser: "mineru-pipeline",
        taskId: "task-minimax-only",
        parsedAt: new Date().toISOString(),
      },
    });

    vi.mocked(minimaxAnalyzer.analyzeImageWithMiniMax).mockResolvedValue({
      summary: "A bar chart",
      ocrText: "10, 20",
      confidence: 0.9,
      warnings: [],
    });

    const pipeline = new DocumentPipeline();
    await pipeline.run(
      makeInput(
        "slides.pptx",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        Buffer.from("pptx"),
        { minimax: "sk-minimax", mineru: "token" }
      )
    );

    expect(minimaxAnalyzer.analyzeImageWithMiniMax).toHaveBeenCalledTimes(1);
    expect(qwenAnalyzer.analyzeImageWithQwen).not.toHaveBeenCalled();
  });
});
