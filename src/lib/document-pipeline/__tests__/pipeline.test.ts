// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";
import { DocumentPipeline } from "../pipeline";
import * as minimaxAnalyzer from "../vision/minimax-analyzer";
import * as mineru from "@/lib/parse/mineru";

vi.mock("../vision/minimax-analyzer");
vi.mock("@/lib/parse/mineru");

beforeEach(() => {
  vi.clearAllMocks();
});

function makeInput(
  filename: string,
  mimeType: string,
  data: Buffer,
  apiKeys: { minimax?: string; mineru?: string } = {}
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
});
