// @vitest-environment node

import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { TextLocalParser } from "../parsers/text-local-parser";
import { markdownToBlocks } from "../parsers/markdown-to-blocks";
import { renderDocumentToMarkdown } from "../renderer";
import { buildChunksFromBlocks } from "../chunk-builder";
import type { DocumentBlock, ParseInput } from "../types";

const FIXTURES_DIR = path.join(__dirname, "fixtures");

function fixtureBuffer(name: string): Buffer {
  return readFileSync(path.join(FIXTURES_DIR, name));
}

function fixtureInput(filename: string): ParseInput {
  return {
    userId: "u1",
    fileAssetId: "f1",
    filename,
    mimeType: "application/octet-stream",
    data: fixtureBuffer(filename),
    apiKeys: {},
  };
}

async function renderFixture(filename: string): Promise<string> {
  const parser = new TextLocalParser();
  const result = await parser.parse(fixtureInput(filename));
  return renderDocumentToMarkdown(result.blocks);
}

const FORMULA_FIXTURES = [
  "markdown-basic.md",
  "latex-cases.md",
  "model-pdf-output.md",
  "model-docx-output.md",
  "model-pptx-output.md",
] as const;

describe("解析回归夹具：公式可信度", () => {
  it.each(FORMULA_FIXTURES)("%s 中的 LaTeX 命令原样保留（不被转义）", (name) => {
    const blocks = markdownToBlocks(fixtureBuffer(name).toString("utf-8"));
    const rendered = renderDocumentToMarkdown(blocks);

    // 转义破坏的标志性特征是反斜杠被翻倍（\frac → \\frac），任何夹具都不应出现
    expect(rendered).not.toContain("\\\\frac");
  });

  it.each([
    ["markdown-basic.md", ["\\int_0^1 x^2 \\, dx = \\frac{1}{3}"]],
    ["latex-cases.md", ["\\frac{a}{b}", "\\sqrt{x^2 + 1}", "\\begin{aligned}", "\\end{aligned}"]],
    ["model-pdf-output.md", ["P(A \\mid B) = \\frac{P(B \\mid A)\\,P(A)}{P(B)}"]],
    ["model-docx-output.md", ["\\bar{T} = \\frac{\\sum T_i}{n}"]],
    ["model-pptx-output.md", ["进程 = 程序 + 数据 + PCB"]],
  ] as const)("%s 的关键公式逐字保留", async (name, formulas) => {
    const rendered = await renderFixture(name);
    for (const formula of formulas) {
      expect(rendered).toContain(formula);
    }
  });

  it("损坏的 LaTeX 原样透传，渲染层不崩溃（错误在展示层可见提示）", async () => {
    const rendered = await renderFixture("latex-cases.md");
    expect(rendered).toContain("$$\\frac{a}{$$");
    expect(rendered).toContain("$$\\sqrtx$$");
  });
});

describe("解析回归夹具：Markdown 结构", () => {
  it("markdown-basic.md 解析出真实标题、表格、公式与代码块", async () => {
    const result = await new TextLocalParser().parse(
      fixtureInput("markdown-basic.md")
    );

    expect(result.blocks.map((b) => b.type)).toEqual([
      "heading",
      "heading",
      "text",
      "table",
      "text",
      "formula",
      "code",
      "text",
    ]);
    const heading = result.blocks[0] as Extract<DocumentBlock, { type: "heading" }>;
    expect(heading.content).toBe("数据结构复习");
    expect(heading.preserveMarkdown).toBe(true);

    const rendered = renderDocumentToMarkdown(result.blocks);
    // 标题、加粗、链接、表格逐字保留
    expect(rendered).toContain("# 数据结构复习");
    expect(rendered).toContain("**顺序表**");
    expect(rendered).toContain("[课程主页](https://example.com/course)");
    expect(rendered).toContain("| 操作 | 顺序表 | 链表 |");
    // 行内公式分隔符保留给展示层 remark-math 处理
    expect(rendered).toContain("$e = mc^2$");
  });

  it("markdown-broken.md 不导致解析或渲染崩溃", async () => {
    await expect(renderFixture("markdown-broken.md")).resolves.toBeTruthy();
  });

  it("model-pdf-output.md 的图片引用与正文保留，可直接进入渲染与分块", () => {
    const blocks = markdownToBlocks(
      fixtureBuffer("model-pdf-output.md").toString("utf-8")
    );
    const rendered = renderDocumentToMarkdown(blocks);

    const image = blocks.find((b) => b.type === "image");
    expect(image).toBeDefined();
    expect((image as Extract<DocumentBlock, { type: "image" }>).relativePath).toBe(
      "pics/arch.png"
    );
    expect(rendered).toContain("![整体架构图](pics/arch.png)");

    // 资源未落库时（空 map）分块不崩溃，图片以兜底文本入索引
    const chunks = buildChunksFromBlocks(blocks, new Map());
    expect(chunks.length).toBeGreaterThan(0);
  });

  it("model-pptx-output.md 的分页线保留为 page-break", () => {
    const blocks = markdownToBlocks(
      fixtureBuffer("model-pptx-output.md").toString("utf-8")
    );
    expect(blocks.filter((b) => b.type === "page-break")).toHaveLength(2);
  });
});

describe("解析回归夹具：文件类型识别", () => {
  it("code-sample.py 解析为带语言的代码块（代码查看器展示，不作为 Markdown 执行）", async () => {
    const result = await new TextLocalParser().parse(fixtureInput("code-sample.py"));

    expect(result.blocks).toHaveLength(1);
    const code = result.blocks[0] as Extract<DocumentBlock, { type: "code" }>;
    expect(code.type).toBe("code");
    expect(code.language).toBe("py");
    expect(code.content).toContain("def fib");

    const rendered = renderDocumentToMarkdown(result.blocks);
    expect(rendered).toBe("```py\n" + code.content + "\n```");
  });

  it("plain-notes.txt 按纯文本转义展示", async () => {
    const rendered = await renderFixture("plain-notes.txt");

    expect(rendered).toContain("\\# 这一行不是 Markdown 标题");
    expect(rendered).toContain("\\*这也不是粗体\\*");
    expect(rendered).toContain("表格管道符 \\| 也应该原样显示");
  });

  it("data-table.csv 按纯文本转义展示", async () => {
    const rendered = await renderFixture("data-table.csv");

    expect(rendered).toContain("姓名,学号,成绩");
    expect(rendered).toContain("王五 \\| 特殊");
  });

  it("tiny.png 不进入文本解析管线（独立图片走 media-ready 短路）", () => {
    const parser = new TextLocalParser();
    expect(parser.canParse(fixtureInput("tiny.png"))).toBe(false);
  });
});
