import { describe, expect, it } from "vitest";
import { markdownToDocx } from "@/lib/export/markdown-to-docx";
import { getPdfFont, markdownToPdf } from "@/lib/export/markdown-to-pdf";

const SAMPLE = `# 中文复习提纲

- **重点**：进程与线程

| 名称 | 说明 |
| --- | --- |
| 进程 | 资源分配单位 |

\`\`\`mermaid
graph LR
  A --> B
\`\`\``;

describe("artifact exporters", () => {
  it("creates a DOCX package from Markdown", async () => {
    const buffer = await markdownToDocx(SAMPLE);
    expect(buffer.subarray(0, 2).toString()).toBe("PK");
  });

  it("creates a PDF containing Chinese Markdown", async () => {
    expect(getPdfFont().subarray(0, 4).toString("hex")).toBe("00010000");
    const buffer = await markdownToPdf(SAMPLE);
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
  }, 20_000);
});
