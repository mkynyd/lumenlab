import { describe, expect, it } from "vitest";
import {
  needsLegacyUnescape,
  unescapeLegacyParsedMarkdown,
} from "./legacy-content";

describe("旧版解析内容的展示层还原", () => {
  it("还原被转义的 Markdown 强调与标题", () => {
    expect(unescapeLegacyParsedMarkdown("\\*\\*顶层标准\\*\\*：GB 17859")).toBe(
      "**顶层标准**：GB 17859"
    );
    expect(unescapeLegacyParsedMarkdown("\\# 不是标题")).toBe("# 不是标题");
    expect(unescapeLegacyParsedMarkdown("表格 \\| 竖线")).toBe("表格 | 竖线");
  });

  it("还原被转义的 LaTeX 命令", () => {
    expect(unescapeLegacyParsedMarkdown("$$\\\\frac\\{a\\}\\{b\\}$$")).toBe(
      "$$\n\\frac{a}{b}\n$$"
    );
    expect(unescapeLegacyParsedMarkdown("\\[x\\]")).toBe("[x]");
  });

  it("把紧贴的块级公式摊开成定界符独占一行", () => {
    // 用 String.raw 让反斜杠个数一眼可见。旧数据里每个反斜杠都被翻倍过：
    // `\begin` 存成 `\\begin`，LaTeX 的换行 `\\` 存成 `\\\\`。
    const legacy = String.raw`$$\\begin{aligned}
a &= b \\\\
c &= d
\\end{aligned}$$`;
    const expected = [
      "$$",
      String.raw`\begin{aligned}`,
      String.raw`a &= b \\`,
      String.raw`c &= d`,
      String.raw`\end{aligned}`,
      "$$",
    ].join("\n");

    expect(unescapeLegacyParsedMarkdown(legacy)).toBe(expected);
  });

  it("多个公式块分别处理，不互相吞并", () => {
    const input = "$$a$$ 中间文字 $$b$$";
    const output = unescapeLegacyParsedMarkdown(input);
    expect(output).toBe("$$\na\n$$ 中间文字 $$\nb\n$$");
  });

  it("保留正文里真正的换行与中文", () => {
    const input = "第一段\n\n第二段 **加粗**";
    expect(unescapeLegacyParsedMarkdown(input)).toBe(input);
  });
});

describe("判断哪些内容需要还原", () => {
  const base = {
    originalName: "讲义.pdf",
    mimeType: "application/pdf",
    pipelineVersion: "0.2.0",
    hasTextContent: true,
  };

  it("旧版本需要还原", () => {
    expect(needsLegacyUnescape(base)).toBe(true);
    expect(needsLegacyUnescape({ ...base, pipelineVersion: "0.1.9" })).toBe(true);
    // 没有版本号说明比任何带版本号的都早
    expect(needsLegacyUnescape({ ...base, pipelineVersion: null })).toBe(true);
  });

  it("新版本不需要还原", () => {
    expect(needsLegacyUnescape({ ...base, pipelineVersion: "0.3.0" })).toBe(false);
    expect(needsLegacyUnescape({ ...base, pipelineVersion: "0.3.1" })).toBe(false);
  });

  it("纯文本类不还原——它们本来就该被转义", () => {
    for (const name of ["笔记.txt", "数据.csv", "配置.json"]) {
      expect(
        needsLegacyUnescape({ ...base, originalName: name, mimeType: "text/plain" })
      ).toBe(false);
    }
  });

  it("图片与没有正文的文件跳过", () => {
    expect(
      needsLegacyUnescape({ ...base, originalName: "截图.png", mimeType: "image/png" })
    ).toBe(false);
    expect(needsLegacyUnescape({ ...base, hasTextContent: false })).toBe(false);
  });

  it("Markdown 与代码文件参与还原", () => {
    expect(needsLegacyUnescape({ ...base, originalName: "笔记.md", mimeType: "text/markdown" })).toBe(true);
    expect(needsLegacyUnescape({ ...base, originalName: "脚本.py", mimeType: "text/x-python" })).toBe(true);
  });
});
