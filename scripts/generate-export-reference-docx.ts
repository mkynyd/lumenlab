import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { Document, HeadingLevel, ImageRun, Packer, Paragraph, TextRun } from "docx";

import { chineseDocxStyles } from "../src/lib/export/docx-styles";

const outputPath = path.join(process.cwd(), "assets", "export", "reference.docx");
const transparentPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

const document = new Document({
  styles: chineseDocxStyles(),
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
