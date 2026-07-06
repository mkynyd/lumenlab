// @vitest-environment node

import { describe, expect, it } from "vitest";
import { renderDocumentToMarkdown } from "@/lib/document-pipeline/renderer";
import type { DocumentBlock } from "@/lib/document-pipeline/types";

describe("renderDocumentToMarkdown", () => {
  it("renders a text block", () => {
    const blocks: DocumentBlock[] = [
      { type: "text", id: "t1", content: "Plain text line." },
    ];

    expect(renderDocumentToMarkdown(blocks)).toBe("Plain text line.");
  });

  it("renders headings with correct marker count", () => {
    const blocks: DocumentBlock[] = [
      { type: "heading", id: "h1", level: 1, content: "Title" },
      { type: "heading", id: "h2", level: 3, content: "Subtitle" },
    ];

    expect(renderDocumentToMarkdown(blocks)).toBe("# Title\n\n### Subtitle");
  });

  it("renders a table block and optional caption", () => {
    const blocks: DocumentBlock[] = [
      {
        type: "table",
        id: "tb1",
        markdown: "| a | b |\n|---|---|\n| 1 | 2 |",
        caption: "Table 1",
      },
      {
        type: "table",
        id: "tb2",
        markdown: "| x | y |",
      },
    ];

    const output = renderDocumentToMarkdown(blocks);
    expect(output).toContain("| a | b |");
    expect(output).toContain("> Table 1");
    expect(output).toContain("| x | y |");
    expect(output.match(/> Table 1/g)).toHaveLength(1);
  });

  it("renders a formula block as display math", () => {
    const blocks: DocumentBlock[] = [
      { type: "formula", id: "f1", content: "E = mc^2" },
    ];

    expect(renderDocumentToMarkdown(blocks)).toBe("$$E = mc^2$$");
  });

  it("renders a code block with language", () => {
    const blocks: DocumentBlock[] = [
      { type: "code", id: "c1", language: "python", content: "print('hi')" },
    ];

    expect(renderDocumentToMarkdown(blocks)).toBe(
      "```python\nprint('hi')\n```"
    );
  });

  it("renders a code block without language", () => {
    const blocks: DocumentBlock[] = [
      { type: "code", id: "c2", content: "plain text" },
    ];

    expect(renderDocumentToMarkdown(blocks)).toBe("```\nplain text\n```");
  });

  it("renders a page break as a horizontal rule", () => {
    const blocks: DocumentBlock[] = [
      { type: "page-break", id: "pb1" },
    ];

    expect(renderDocumentToMarkdown(blocks)).toBe("---");
  });

  it("renders an image with alt text and no quote when no analysis exists", () => {
    const blocks: DocumentBlock[] = [
      {
        type: "image",
        id: "i1",
        assetId: "a1",
        relativePath: "pics/chart.png",
        altText: "A chart",
        analysisStatus: "pending",
      },
    ];

    expect(renderDocumentToMarkdown(blocks)).toBe("![A chart](pics/chart.png)");
  });

  it("renders an image with vision summary quoted", () => {
    const blocks: DocumentBlock[] = [
      {
        type: "image",
        id: "i2",
        assetId: "a2",
        relativePath: "pics/fig.png",
        altText: "Figure",
        analysisStatus: "parsed",
        visionSummary: "Shows growth over time.",
      },
    ];

    const output = renderDocumentToMarkdown(blocks);
    expect(output).toContain("![Figure](pics/fig.png)");
    expect(output).toContain("> Shows growth over time.");
  });

  it("prefers visionSummary over visionText and extractedText", () => {
    const blocks: DocumentBlock[] = [
      {
        type: "image",
        id: "i3",
        assetId: "a3",
        relativePath: "pics/x.png",
        analysisStatus: "parsed",
        visionSummary: "summary",
        visionText: "text",
        extractedText: "extracted",
      },
    ];

    expect(renderDocumentToMarkdown(blocks)).toContain("> summary"
    );
    expect(renderDocumentToMarkdown(blocks)).not.toContain("> text");
  });

  it("quotes extractedText when no vision result is present", () => {
    const blocks: DocumentBlock[] = [
      {
        type: "image",
        id: "i4",
        assetId: "a4",
        relativePath: "pics/y.png",
        analysisStatus: "parsed",
        extractedText: "OCR result",
      },
    ];

    expect(renderDocumentToMarkdown(blocks)).toContain("> OCR result");
  });

  it("shows a low-confidence warning when confidence is below threshold", () => {
    const blocks: DocumentBlock[] = [
      {
        type: "image",
        id: "i5",
        assetId: "a5",
        relativePath: "pics/z.png",
        analysisStatus: "parsed",
        confidence: 0.3,
      },
    ];

    const output = renderDocumentToMarkdown(blocks);
    expect(output).toContain("![image](pics/z.png)");
    expect(output).toContain("> 置信度较低");
  });

  it("shows a failure message for failed analysis", () => {
    const blocks: DocumentBlock[] = [
      {
        type: "image",
        id: "i6",
        assetId: "a6",
        relativePath: "pics/bad.png",
        analysisStatus: "failed",
        skipReason: "vision timeout",
      },
    ];

    const output = renderDocumentToMarkdown(blocks);
    expect(output).toContain("![image](pics/bad.png)");
    expect(output).toContain("> 视觉理解失败");
    expect(output).toContain("vision timeout");
  });

  it("shows a skip reason for skipped analysis", () => {
    const blocks: DocumentBlock[] = [
      {
        type: "image",
        id: "i7",
        assetId: "a7",
        relativePath: "pics/skip.png",
        analysisStatus: "skipped",
        skipReason: "decorative image",
      },
    ];

    const output = renderDocumentToMarkdown(blocks);
    expect(output).toContain("> 已跳过视觉理解");
    expect(output).toContain("decorative image");
  });

  it("separates multiple blocks with blank lines", () => {
    const blocks: DocumentBlock[] = [
      { type: "text", id: "t1", content: "First" },
      { type: "text", id: "t2", content: "Second" },
    ];

    expect(renderDocumentToMarkdown(blocks)).toBe("First\n\nSecond");
  });
});
