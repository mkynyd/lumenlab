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
    expect(output).toContain("*Table 1*");
    expect(output).toContain("| x | y |");
    expect(output.match(/\*Table 1\*/g)).toHaveLength(1);
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
      "```python\nprint\\('hi'\\)\n```"
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
    expect(output).toContain("> 图像解析：Shows growth over time.");
  });

  it("renders all present image annotation fields separately", () => {
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

    const output = renderDocumentToMarkdown(blocks);
    expect(output).toContain("> 图像解析：summary");
    expect(output).toContain("> 图中文字：text");
    expect(output).toContain("> 结构化内容：extracted");
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

    expect(renderDocumentToMarkdown(blocks)).toContain("> 结构化内容：OCR result");
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
    expect(output).toContain("![](pics/z.png)");
    expect(output).toContain("> 注意：低置信度，关键数字/公式建议核对原文。");
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
    expect(output).toContain("![](pics/bad.png)");
    expect(output).toContain("> 图像解析失败");
    expect(output).toContain("vision timeout");
  });

  it("renders only the image line for skipped analysis", () => {
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

    expect(renderDocumentToMarkdown(blocks)).toBe("![](pics/skip.png)");
  });

  it("separates multiple blocks with blank lines", () => {
    const blocks: DocumentBlock[] = [
      { type: "text", id: "t1", content: "First" },
      { type: "text", id: "t2", content: "Second" },
    ];

    expect(renderDocumentToMarkdown(blocks)).toBe("First\n\nSecond");
  });

  it("returns an empty string for an empty block array", () => {
    expect(renderDocumentToMarkdown([])).toBe("");
  });

  it("clamps heading levels to the range 1-6", () => {
    const blocks: DocumentBlock[] = [
      { type: "heading", id: "h1", level: 0, content: "Too low" },
      { type: "heading", id: "h2", level: 8, content: "Too high" },
    ];

    expect(renderDocumentToMarkdown(blocks)).toBe("# Too low\n\n###### Too high");
  });

  it("escapes markdown special characters in content", () => {
    const blocks: DocumentBlock[] = [
      { type: "text", id: "t1", content: "*not bold*" },
      { type: "heading", id: "h1", level: 1, content: "# not a heading" },
      { type: "formula", id: "f1", content: "x * y" },
      {
        type: "table",
        id: "tb1",
        markdown: "|a|",
        caption: "*not italic*",
      },
    ];

    const output = renderDocumentToMarkdown(blocks);
    expect(output).toContain("\\*not bold\\*");
    expect(output).toContain("# \\# not a heading");
    expect(output).toContain("$$x \\* y$$");
    expect(output).toContain("\\*not italic\\*");
  });

  it("does not escape backticks inside code blocks", () => {
    const blocks: DocumentBlock[] = [
      {
        type: "code",
        id: "c1",
        language: "ts",
        content: "const x = `hello`;",
      },
    ];

    expect(renderDocumentToMarkdown(blocks)).toBe(
      "```ts\nconst x = `hello`;\n```"
    );
  });

  it("escapes image alt text and url-encodes the image path", () => {
    const blocks: DocumentBlock[] = [
      {
        type: "image",
        id: "i1",
        assetId: "a1",
        relativePath: "path with spaces/image.png",
        altText: "[not](a link)",
        analysisStatus: "pending",
      },
    ];

    const output = renderDocumentToMarkdown(blocks);
    expect(output).toContain("\\[not\\]\\(a link\\)");
    expect(output).toContain("path%20with%20spaces/image.png");
  });

  it("replaces newlines with spaces in failed image skip reasons", () => {
    const blocks: DocumentBlock[] = [
      {
        type: "image",
        id: "i1",
        assetId: "a1",
        relativePath: "bad.png",
        analysisStatus: "failed",
        skipReason: "line one\nline two",
      },
    ];

    const output = renderDocumentToMarkdown(blocks);
    expect(output).toContain("line one line two");
    expect(output).not.toContain("line one\nline two");
  });

  it("appends a low-confidence warning even when other annotations exist", () => {
    const blocks: DocumentBlock[] = [
      {
        type: "image",
        id: "i1",
        assetId: "a1",
        relativePath: "x.png",
        analysisStatus: "parsed",
        visionSummary: "summary",
        confidence: 0.3,
      },
    ];

    const output = renderDocumentToMarkdown(blocks);
    expect(output).toContain("> 图像解析：summary");
    expect(output).toContain("低置信度");
  });

  it("preserves trailing whitespace without trimming", () => {
    const blocks: DocumentBlock[] = [
      { type: "text", id: "t1", content: "line ending with two spaces  " },
    ];

    expect(renderDocumentToMarkdown(blocks)).toBe("line ending with two spaces  ");
  });

  it("escapes markdown characters in vision analysis strings", () => {
    const blocks: DocumentBlock[] = [
      {
        type: "image",
        id: "i1",
        assetId: "a1",
        relativePath: "x.png",
        analysisStatus: "parsed",
        visionSummary: "*bold* summary",
        visionText: "[link](url)",
        extractedText: "`code`",
      },
    ];

    const output = renderDocumentToMarkdown(blocks);
    expect(output).toContain("> 图像解析：\\*bold\\* summary");
    expect(output).toContain("> 图中文字：\\[link\\]\\(url\\)");
    expect(output).toContain("> 结构化内容：\\`code\\`");
  });

  it("encodes characters that break markdown link syntax in image paths", () => {
    const blocks: DocumentBlock[] = [
      {
        type: "image",
        id: "i1",
        assetId: "a1",
        relativePath: "path/with(parens)[brackets]and spaces.png?x=1#frag",
        altText: "image",
        analysisStatus: "pending",
      },
    ];

    const output = renderDocumentToMarkdown(blocks);
    expect(output).toContain(
      "![image](path/with%28parens%29%5Bbrackets%5Dand%20spaces.png%3Fx=1%23frag)"
    );
  });
});
