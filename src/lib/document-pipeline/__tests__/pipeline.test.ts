// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";
import { DocumentPipeline } from "../pipeline";
import * as mineru from "@/lib/parse/mineru";

vi.mock("@/lib/parse/mineru");

beforeEach(() => {
  vi.clearAllMocks();
});

function makeInput(
  filename: string,
  mimeType: string,
  data: Buffer,
  apiKeys: { mineru?: string } = {}
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

  it.each([["small", 512], ["large", 21 * 1024 * 1024]])("routes a %s PDF to MinerU", async (size, bytes) => {
    vi.mocked(mineru.parseFileWithMinerU).mockResolvedValue({
      content: "# Parsed PDF",
      assets: [],
      metadata: { parser: "mineru-pipeline", taskId: "task-pdf", parsedAt: new Date().toISOString() },
    });

    const result = await new DocumentPipeline().run(
      makeInput(size + ".pdf", "application/pdf", Buffer.alloc(bytes), { mineru: "token" })
    );

    expect(mineru.parseFileWithMinerU).toHaveBeenCalledTimes(1);
    expect(result.metadata).toMatchObject({ parser: "mineru-pdf", sourceKind: "pdf" });
    expect(result.content).toContain("# Parsed PDF");
  });

  it("reports missing MinerU access for PDFs before an upstream request", async () => {
    const pipeline = new DocumentPipeline();
    await expect(pipeline.run(makeInput("doc.pdf", "application/pdf", Buffer.from("pdf"))))
      .rejects.toThrow("MinerU Token");
    expect(mineru.parseFileWithMinerU).not.toHaveBeenCalled();
  });

  it("rejects PDFs above the MinerU 200MB limit with a clear error", async () => {
    const pipeline = new DocumentPipeline();
    await expect(
      pipeline.run(
        makeInput("huge.pdf", "application/pdf", Buffer.alloc(200 * 1024 * 1024 + 1), {
          mineru: "token",
        })
      )
    ).rejects.toThrow("PDF 文件超过 200MB 解析上限");
    expect(mineru.parseFileWithMinerU).not.toHaveBeenCalled();
  });
});
