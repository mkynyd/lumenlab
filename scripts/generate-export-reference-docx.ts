import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { Document, HeadingLevel, ImageRun, Packer, Paragraph, TextRun } from "docx";

const outputPath = path.join(process.cwd(), "assets", "export", "reference.docx");
const transparentPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

const document = new Document({
  styles: {
    default: {
      document: {
        run: { font: "Noto Sans SC", size: 22 },
        paragraph: { spacing: { line: 360, after: 160 } },
      },
    },
    paragraphStyles: [
      {
        id: "Heading1",
        name: "Heading 1",
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
        run: { font: "Noto Sans SC", size: 32, bold: true },
        paragraph: { spacing: { before: 360, after: 200 }, outlineLevel: 0, keepNext: true },
      },
      {
        id: "Heading2",
        name: "Heading 2",
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
        run: { font: "Noto Sans SC", size: 28, bold: true },
        paragraph: { spacing: { before: 280, after: 160 }, outlineLevel: 1, keepNext: true },
      },
      {
        id: "Heading3",
        name: "Heading 3",
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
        run: { font: "Noto Sans SC", size: 24, bold: true },
        paragraph: { spacing: { before: 220, after: 120 }, outlineLevel: 2, keepNext: true },
      },
    ],
  },
  sections: [
    {
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 },
        },
      },
      children: [
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun("LumenLab 导出参考样式")],
        }),
        new Paragraph({
          children: [new TextRun("该段仅用于定义 Pandoc 导出的版式，不会出现在实际成果中。")],
        }),
        // Ensure the reference package declares PNG content types. Pandoc
        // preserves that declaration when it later embeds rendered diagrams.
        new Paragraph({
          children: [
            new ImageRun({
              type: "png",
              data: transparentPng,
              transformation: { width: 1, height: 1 },
              altText: { title: "", description: "", name: "" },
            }),
          ],
        }),
      ],
    },
  ],
});

async function main() {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, await Packer.toBuffer(document));
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
