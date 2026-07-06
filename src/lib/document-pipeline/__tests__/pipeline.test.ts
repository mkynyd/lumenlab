// @vitest-environment node

import { describe, it, expect, vi } from "vitest";
import { DocumentPipeline } from "../pipeline";
import * as minimaxAnalyzer from "../vision/minimax-analyzer";
import * as mineru from "@/lib/parse/mineru";

vi.mock("../vision/minimax-analyzer");
vi.mock("@/lib/parse/mineru");

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
    expect(call.image).toEqual({
      type: "url",
      url: `/api/files/f1/resources/${image.assetId}`,
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
});
