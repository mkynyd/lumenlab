// @vitest-environment node

import AdmZip from "adm-zip";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ renderMermaidPng: vi.fn() }));

vi.mock("@/lib/export/mermaid-image", () => ({
  renderMermaidPng: mocks.renderMermaidPng,
}));

import {
  markdownToPandocDocx,
  normalizeHtmlTablesForPandoc,
} from "@/lib/export/pandoc-docx";

describe("Pandoc DOCX exporter", () => {
  const onePixelPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  );

  beforeEach(() => {
    mocks.renderMermaidPng.mockResolvedValue(onePixelPng);
  });

  it("normalizes copied HTML tables into an actual Markdown table", () => {
    expect(
      normalizeHtmlTablesForPandoc(
        "<table><tr><th>名称</th><th>说明</th></tr><tr><td>Agent</td><td>执行任务</td></tr></table>"
      )
    ).toBe("| 名称 | 说明 |\n| --- | --- |\n| Agent | 执行任务 |");
  });

  it("embeds LumenFlow diagrams as DOCX media", async () => {
    const buffer = await markdownToPandocDocx(`## 工作流

| 阶段 | 结果 |
| --- | --- |
| 导出 | 已完成 |

\`\`\`lumenflow
{"version":1,"title":"工作流","nodes":[{"id":"start","label":"开始"},{"id":"finish","label":"完成","tone":"primary"}],"edges":[["start","finish"]]}
\`\`\``);
    const entries = new AdmZip(buffer).getEntries().map((entry) => entry.entryName);

    expect(entries.some((entry) => entry.startsWith("word/media/"))).toBe(true);
    const contentTypes = new AdmZip(buffer)
      .readAsText("[Content_Types].xml");
    expect(contentTypes).toContain('Extension="png"');
    const documentXml = new AdmZip(buffer).readAsText("word/document.xml");
    expect(documentXml).not.toContain("<w:tbl>");
  }, 20_000);

  it("turns Mermaid source into local DOCX media instead of leaving source code", async () => {
    const buffer = await markdownToPandocDocx("```mermaid\nflowchart LR\n  A --> B\n```");

    expect(mocks.renderMermaidPng).toHaveBeenCalledWith("flowchart LR\n  A --> B");
    expect(
      new AdmZip(buffer)
        .getEntries()
        .some((entry) => entry.entryName.startsWith("word/media/"))
    ).toBe(true);
  });
});
