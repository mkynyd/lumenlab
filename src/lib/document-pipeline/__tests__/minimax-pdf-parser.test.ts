// @vitest-environment node

import { describe, it, expect, vi } from "vitest";
import { MiniMaxPdfParser } from "../parsers/minimax-pdf-parser";
import * as minimax from "@/lib/vision/minimax";

vi.mock("@/lib/vision/minimax");

function makeInput(filename: string, mimeType: string, data: Buffer, apiKeys: { minimax?: string } = {}) {
  return {
    userId: "u1",
    fileAssetId: "f1",
    filename,
    mimeType,
    data,
    apiKeys,
  };
}

describe("MiniMaxPdfParser", () => {
  it("can parse PDF by extension or mime type", () => {
    const parser = new MiniMaxPdfParser();
    expect(parser.canParse(makeInput("doc.pdf", "application/octet-stream", Buffer.from("pdf")))).toBe(true);
    expect(parser.canParse(makeInput("doc", "application/pdf", Buffer.from("pdf")))).toBe(true);
    expect(parser.canParse(makeInput("notes.md", "text/markdown", Buffer.from("md")))).toBe(false);
  });

  it("throws when MiniMax API key is missing", async () => {
    const parser = new MiniMaxPdfParser();
    await expect(parser.parse(makeInput("doc.pdf", "application/pdf", Buffer.from("pdf")))).rejects.toThrow(
      "MiniMax API Key"
    );
  });

  it("parses pdf into blocks and marks embedded images as skipped", async () => {
    vi.mocked(minimax.parseDocumentWithMiniMax).mockResolvedValue(
      "# Title\n\nText\n\n![figure](pics/fig.png)"
    );

    const parser = new MiniMaxPdfParser();
    const input = makeInput("doc.pdf", "application/pdf", Buffer.from("pdf"), { minimax: "sk-test" });

    const progress = vi.fn();
    const result = await parser.parse(input, progress);

    expect(progress).toHaveBeenCalledWith("model");
    expect(result.blocks[0].type).toBe("heading");
    expect((result.blocks[0] as Extract<typeof result.blocks[number], { type: "heading" }>).content).toBe("Title");

    const image = result.blocks.find((b) => b.type === "image") as Extract<
      typeof result.blocks[number],
      { type: "image" }
    >;
    expect(image).toBeDefined();
    expect(image.relativePath).toBe("pics/fig.png");
    expect(image.analysisStatus).toBe("skipped");
    expect(image.skipReason).toBe("minimax-document-embedded");

    expect(result.assets).toHaveLength(0);
    expect(result.metadata.parser).toBe("minimax-m3-pdf");
    expect(result.metadata.sourceKind).toBe("pdf");
    expect(result.metadata.pipelineVersion).toBe("0.2.0");
    expect(result.metadata.requiresVisionModel).toBe(true);
    expect(result.metadata.assetCount).toBe(0);
  });
});
