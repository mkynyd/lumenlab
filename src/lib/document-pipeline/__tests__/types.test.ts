// @vitest-environment node

import { describe, expect, it } from "vitest";
import * as typesModule from "@/lib/document-pipeline/types";
import type {
  DocumentBlock,
  TextBlock,
  HeadingBlock,
  TableBlock,
  FormulaBlock,
  ImageBlock,
  CodeBlock,
  PageBreakBlock,
  ParsedAsset,
  ParseInput,
  ParseResult,
  ParsingMetadata,
  DocumentParser,
  ProgressCallback,
} from "@/lib/document-pipeline/types";

describe("document-pipeline types", () => {
  it("exports a loadable types module", () => {
    expect(typesModule).toBeDefined();
  });

  it("exports a TextBlock with required fields", () => {
    const block: TextBlock = {
      type: "text",
      id: "text-1",
      pageNumber: 1,
      content: "hello world",
    };

    expect(block.type).toBe("text");
    expect(block.content).toBe("hello world");
    expect(block.pageNumber).toBe(1);
  });

  it("exports a HeadingBlock with level", () => {
    const block: HeadingBlock = {
      type: "heading",
      id: "heading-1",
      level: 2,
      content: "Section title",
    };

    expect(block.level).toBe(2);
    expect(block.content).toBe("Section title");
  });

  it("exports a TableBlock with optional caption", () => {
    const block: TableBlock = {
      type: "table",
      id: "table-1",
      markdown: "| a | b |\n|---|---|\n| 1 | 2 |",
      caption: "Sample table",
    };

    expect(block.caption).toBe("Sample table");
  });

  it("exports a FormulaBlock", () => {
    const block: FormulaBlock = {
      type: "formula",
      id: "formula-1",
      content: "E = mc^2",
    };

    expect(block.content).toBe("E = mc^2");
  });

  it("exports an ImageBlock with analysis status", () => {
    const block: ImageBlock = {
      type: "image",
      id: "image-1",
      assetId: "asset-1",
      relativePath: "pics/chart.png",
      altText: "A chart",
      visionSummary: "Summary of the chart",
      analysisStatus: "parsed",
      confidence: 0.95,
    };

    expect(block.analysisStatus).toBe("parsed");
    expect(block.assetId).toBe("asset-1");
    expect(block.relativePath).toBe("pics/chart.png");
  });

  it("exports a CodeBlock with optional language", () => {
    const block: CodeBlock = {
      type: "code",
      id: "code-1",
      language: "typescript",
      content: "const x = 1;",
    };

    expect(block.language).toBe("typescript");
  });

  it("exports a PageBreakBlock", () => {
    const block: PageBreakBlock = { type: "page-break", id: "break-1" };
    expect(block.type).toBe("page-break");
  });

  it("DocumentBlock union can hold every block shape", () => {
    const blocks: DocumentBlock[] = [
      { type: "text", id: "t1", content: "text" },
      { type: "heading", id: "h1", level: 1, content: "heading" },
      { type: "table", id: "tb1", markdown: "|x|" },
      { type: "formula", id: "f1", content: "x" },
      {
        type: "image",
        id: "i1",
        assetId: "a1",
        relativePath: "p.png",
        analysisStatus: "pending",
      },
      { type: "code", id: "c1", content: "code" },
      { type: "page-break", id: "pb1" },
    ];

    expect(blocks).toHaveLength(7);
  });

  it("ParsedAsset carries a Buffer and sha256", () => {
    const asset: ParsedAsset = {
      id: "asset-1",
      relativePath: "pics/diagram.png",
      mimeType: "image/png",
      buffer: Buffer.from([1, 2, 3]),
      sha256: "abc123",
    };

    expect(asset.buffer).toEqual(Buffer.from([1, 2, 3]));
    expect(asset.sha256).toBe("abc123");
  });

  it("ParseInput contains api keys and file data", () => {
    const input: ParseInput = {
      userId: "user-1",
      fileAssetId: "file-1",
      filename: "report.pdf",
      mimeType: "application/pdf",
      data: Buffer.from("pdf"),
      apiKeys: { minimax: "k1", mineru: "k2", bailian: "k3" },
    };

    expect(input.filename).toBe("report.pdf");
    expect(input.apiKeys.mineru).toBe("k2");
  });

  it("ParseResult metadata contains required timestamps", () => {
    const metadata: ParsingMetadata = {
      parser: "test-parser",
      pipelineVersion: "1.0.0",
      sourceKind: "pdf",
      requiresVisionModel: false,
      assetCount: 0,
      parseStartedAt: "2026-07-06T00:00:00Z",
      parseCompletedAt: "2026-07-06T00:01:00Z",
      parseWarnings: ["slow"],
      strategy: "native",
    };

    const result: ParseResult = {
      blocks: [],
      assets: [],
      metadata,
    };

    expect(result.metadata.parseWarnings).toContain("slow");
    expect(result.metadata.assetCount).toBe(0);
  });

  it("DocumentParser contract can be implemented", async () => {
    const parser: DocumentParser = {
      parserId: "test-parser",
      sourceKind: "pdf",
      canParse: (input: ParseInput) => input.mimeType === "application/pdf",
      parse: async (_input: ParseInput, onProgress?: ProgressCallback) => {
        onProgress?.("parsing", { current: 1, total: 2 });
        const metadata: ParsingMetadata = {
          parser: "test-parser",
          pipelineVersion: "1.0.0",
          sourceKind: "pdf",
          requiresVisionModel: false,
          assetCount: 0,
          parseStartedAt: new Date().toISOString(),
          parseCompletedAt: new Date().toISOString(),
          parseWarnings: [],
        };
        return { blocks: [], assets: [], metadata };
      },
    };

    const input: ParseInput = {
      userId: "user-1",
      fileAssetId: "file-1",
      filename: "report.pdf",
      mimeType: "application/pdf",
      data: Buffer.from("pdf"),
      apiKeys: {},
    };

    expect(parser.parserId).toBe("test-parser");
    expect(parser.canParse(input)).toBe(true);
    const result = await parser.parse(input, (stage, progress) => {
      expect(stage).toBe("parsing");
      expect(progress).toEqual({ current: 1, total: 2 });
    });
    expect(result.metadata.parser).toBe("test-parser");
  });
});
