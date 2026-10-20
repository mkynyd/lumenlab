// @vitest-environment node

import AdmZip from "adm-zip";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/export/mermaid-image", () => ({
  renderMermaidPng: vi.fn().mockResolvedValue(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64"
    )
  ),
}));
vi.mock("@/lib/export/pandoc-docx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/export/pandoc-docx")>();
  return { ...actual, markdownToPandocDocx: vi.fn(actual.markdownToPandocDocx) };
});
import { legacyMarkdownToDocx, markdownToDocx } from "@/lib/export/markdown-to-docx";
import { markdownToPandocDocx } from "@/lib/export/pandoc-docx";
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

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

describe("artifact exporters", () => {
  it("creates a DOCX package from Markdown", async () => {
    const buffer = await markdownToDocx(SAMPLE);
    expect(buffer.subarray(0, 2).toString()).toBe("PK");
    const archive = new AdmZip(buffer);
    expect(archive.readFile("word/fonts/font1.odttf")?.length).toBeGreaterThan(100_000);
    expect(archive.readAsText("word/fontTable.xml")).toContain("w:embedRegular");
    const styles = new AdmZip(buffer).readAsText("word/styles.xml");
    expect(styles).toContain('w:eastAsia="Noto Sans SC"');
    expect(styles).toContain('w:eastAsia="zh-CN"');
  });

  it("keeps explicit Chinese fonts and language in the fallback document and heading styles", async () => {
    const zip = new AdmZip(await legacyMarkdownToDocx("# 中文标题\n\n中文正文与 English\n\n`中文代码`"));
    const styles = zip.readAsText("word/styles.xml");
    expect(styles).toContain('w:eastAsia="Noto Sans SC"');
    expect(styles).toContain('w:eastAsia="zh-CN"');
    const heading = styles.match(/<w:style[^>]*w:styleId="Heading1"[\s\S]*?<\/w:style>/)?.[0];
    expect(heading).toContain('w:eastAsia="Noto Sans SC"');
    expect(zip.readAsText("word/document.xml")).toContain('w:eastAsia="Noto Sans SC"');
  });

  it("keeps fallback Chinese tables at readable page width", async () => {
    const xml = new AdmZip(await legacyMarkdownToDocx("| 环节 | 活动 |\n| --- | --- |\n| 准备 | 整理书包 |" )).readAsText("word/document.xml");
    expect(xml).toContain('w:tblW w:type="dxa" w:w="9000"');
    expect(xml).toContain('w:tcW w:type="dxa" w:w="4500"');
    expect(xml).toContain("整理书包");
  });

  it("embeds resolved Markdown images inside the DOCX package", async () => {
    const buffer = await markdownToDocx("# 电路\n\n![电路图](pics/circuit.png)", {
      resolveImage: async (src) =>
        src === "pics/circuit.png"
          ? { buffer: ONE_PIXEL_PNG, mimeType: "image/png" }
          : null,
    });
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries().map((entry) => entry.entryName);

    expect(entries.some((entry) => entry.startsWith("word/media/"))).toBe(true);
  });

  it("creates a PDF containing Chinese Markdown", async () => {
    expect(getPdfFont().subarray(0, 4).toString("hex")).toBe("774f4632");
    const buffer = await markdownToPdf(SAMPLE);
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
  }, 20_000);

  it("falls back to the legacy DOCX renderer when pandoc reports it is not installed", async () => {
    vi.mocked(markdownToPandocDocx).mockRejectedValueOnce(
      new Error("未安装 Pandoc，无法生成 DOCX。")
    );

    const buffer = await markdownToDocx(SAMPLE);

    expect(buffer.subarray(0, 2).toString()).toBe("PK");
  });

  it("falls back to the legacy DOCX renderer on an ENOENT spawn error", async () => {
    const error = new Error("spawn pandoc ENOENT");
    (error as NodeJS.ErrnoException).code = "ENOENT";
    vi.mocked(markdownToPandocDocx).mockRejectedValueOnce(error);

    const buffer = await markdownToDocx(SAMPLE);

    expect(buffer.subarray(0, 2).toString()).toBe("PK");
  });

  it("does not silently fall back on unrelated export errors", async () => {
    vi.mocked(markdownToPandocDocx).mockRejectedValueOnce(
      new Error("Mermaid 图表渲染失败：boom")
    );

    await expect(markdownToDocx(SAMPLE)).rejects.toThrow("Mermaid 图表渲染失败");
  });
});
