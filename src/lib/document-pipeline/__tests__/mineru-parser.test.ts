// @vitest-environment node

import { describe, it, expect, vi } from "vitest";
import { MinerUParser } from "../parsers/mineru-parser";
import { assignAssetIdsToImageBlocks, markdownToBlocks } from "../parsers/markdown-to-blocks";
import type { ParsedAsset } from "../types";
import * as mineru from "@/lib/parse/mineru";

vi.mock("@/lib/parse/mineru");

function makeInput(filename: string, mimeType: string, data: Buffer, apiKeys: { mineru?: string } = {}) {
  return {
    userId: "u1",
    fileAssetId: "f1",
    filename,
    mimeType,
    data,
    apiKeys,
  };
}

describe("markdownToBlocks", () => {
  it("converts headings, paragraphs, and code fences", () => {
    const markdown = "# Title\n\nSome text.\n\n```ts\nconst x = 1;\n```\n\nMore text.";
    const blocks = markdownToBlocks(markdown);

    expect(blocks.map((b) => b.type)).toEqual(["heading", "text", "code", "text"]);
    expect(blocks[0]).toMatchObject({ type: "heading", level: 1, content: "Title" });
    expect(blocks[2]).toMatchObject({ type: "code", language: "ts", content: "const x = 1;" });
  });

  it("converts tables", () => {
    const markdown = "| a | b |\n|---|---|\n| 1 | 2 |";
    const blocks = markdownToBlocks(markdown);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("table");
    expect((blocks[0] as Extract<typeof blocks[number], { type: "table" }>).markdown).toContain("| a | b |");
  });

  it("converts images", () => {
    const markdown = "![chart](pics/chart.png)";
    const blocks = markdownToBlocks(markdown);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("image");
    expect((blocks[0] as Extract<typeof blocks[number], { type: "image" }>).relativePath).toBe("pics/chart.png");
    expect((blocks[0] as Extract<typeof blocks[number], { type: "image" }>).assetId).toBe("");
  });

  it("converts single-line and multi-line formulas", () => {
    const markdown = "$$E = mc^2$$\n\n$$\na^2 + b^2 = c^2\n$$";
    const blocks = markdownToBlocks(markdown);

    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe("formula");
    expect((blocks[0] as Extract<typeof blocks[number], { type: "formula" }>).content).toBe("E = mc^2");
    expect(blocks[1].type).toBe("formula");
    expect((blocks[1] as Extract<typeof blocks[number], { type: "formula" }>).content).toBe("a^2 + b^2 = c^2");
  });

  it("converts horizontal rules to page breaks", () => {
    const markdown = "Before\n\n---\n\nAfter";
    const blocks = markdownToBlocks(markdown);

    expect(blocks.map((b) => b.type)).toEqual(["text", "page-break", "text"]);
  });
});

describe("assignAssetIdsToImageBlocks", () => {
  it("sets assetId on matching image blocks", () => {
    const asset: ParsedAsset = {
      id: "asset-1",
      relativePath: "pics/chart.png",
      mimeType: "image/png",
      buffer: Buffer.alloc(100),
      sha256: "abc",
    };
    const blocks = markdownToBlocks("![chart](pics/chart.png)");
    assignAssetIdsToImageBlocks(blocks, new Map([[asset.relativePath, asset]]));

    expect((blocks[0] as Extract<typeof blocks[number], { type: "image" }>).assetId).toBe("asset-1");
  });
});

describe("MinerUParser", () => {
  it("can parse supported office extensions", () => {
    const parser = new MinerUParser();
    expect(parser.canParse(makeInput("slides.pptx", "application/octet-stream", Buffer.from("x")))).toBe(true);
    expect(parser.canParse(makeInput("report.docx", "application/octet-stream", Buffer.from("x")))).toBe(true);
    expect(parser.canParse(makeInput("sheet.xlsx", "application/octet-stream", Buffer.from("x")))).toBe(true);
    expect(parser.canParse(makeInput("slides.pages", "application/octet-stream", Buffer.from("x")))).toBe(true);
  });

  it("does not parse unsupported files", () => {
    const parser = new MinerUParser();
    expect(parser.canParse(makeInput("notes.md", "text/markdown", Buffer.from("x")))).toBe(false);
    expect(parser.canParse(makeInput("report.pdf", "application/pdf", Buffer.from("x")))).toBe(false);
  });

  it("throws when MinerU token is missing", async () => {
    const parser = new MinerUParser();
    await expect(parser.parse(makeInput("slides.pptx", "application/octet-stream", Buffer.from("x")))).rejects.toThrow(
      "MinerU Token"
    );
  });

  it("converts MinerU result into blocks and assets", async () => {
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

    const parser = new MinerUParser();
    const input = makeInput(
      "slides.pptx",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      Buffer.from("pptx"),
      { mineru: "token" }
    );

    const result = await parser.parse(input);

    expect(result.blocks[0].type).toBe("heading");
    const image = result.blocks.find((b) => b.type === "image") as Extract<
      typeof result.blocks[number],
      { type: "image" }
    >;
    expect(image).toBeDefined();
    expect(image.assetId).toBeTruthy();
    expect(image.relativePath).toBe("pics/chart.png");
    expect(image.analysisStatus).toBe("pending");
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0].sha256).toHaveLength(64);
    expect(result.metadata.assetCount).toBe(1);
    expect(result.metadata.parser).toBe("mineru-office");
    expect(result.metadata.sourceKind).toBe("office");
    expect(result.metadata.pipelineVersion).toBe("0.2.0");
    expect(result.metadata.requiresVisionModel).toBe(true);
    expect(result.metadata.parseWarnings).toEqual([]);
  });

  it("marks image blocks without a matching asset as skipped with a warning", async () => {
    vi.mocked(mineru.parseFileWithMinerU).mockResolvedValue({
      content: "# Slide\n\n![missing](pics/missing.png)",
      assets: [],
      metadata: {
        parser: "mineru-pipeline",
        taskId: "task-2",
        parsedAt: new Date().toISOString(),
      },
    });

    const parser = new MinerUParser();
    const result = await parser.parse(
      makeInput("slides.pptx", "application/octet-stream", Buffer.from("pptx"), { mineru: "token" })
    );

    const image = result.blocks.find((b) => b.type === "image") as Extract<
      typeof result.blocks[number],
      { type: "image" }
    >;
    expect(image).toBeDefined();
    expect(image.assetId).toBe("");
    expect(image.analysisStatus).toBe("skipped");
    expect(image.skipReason).toBe("asset-missing");
    expect(result.metadata.parseWarnings).toContain("图片引用未找到资源: pics/missing.png");
  });
});
