// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";
import { DocumentPipeline } from "../pipeline";
import * as mineru from "@/lib/parse/mineru";
import * as minimax from "@/lib/vision/minimax";

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
  });

  it("throws for unsupported file types", async () => {
    const pipeline = new DocumentPipeline();
    await expect(
      pipeline.run(makeInput("song.mp3", "audio/mpeg", Buffer.from("mp3")))
    ).rejects.toThrow("不支持的文件类型: .mp3");
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
});
