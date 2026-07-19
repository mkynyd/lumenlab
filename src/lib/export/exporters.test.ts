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

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

describe("artifact exporters", () => {
  it("creates a DOCX package from Markdown", async () => {
    const buffer = await markdownToDocx(SAMPLE);
    expect(buffer.subarray(0, 2).toString()).toBe("PK");
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
});
