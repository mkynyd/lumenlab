/**
 * artifact.export_docx — Markdown artifact → .docx
 *
 * 基于 npm `docx` 库生成 OOXML；MVP 只覆盖段落、标题、列表、表格（最常用的部分）。
 * 返回 base64（用户前端可下载）；后续可改为写到对象存储并返回签名 URL。
 */

import { Buffer } from "node:buffer";
import {
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  ShadingType,
} from "docx";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

interface ParsedBlock {
  kind: "heading" | "paragraph" | "list" | "code" | "table" | "blank";
  level?: number;
  text?: string;
  items?: string[];
  language?: string;
  rows?: string[][];
}

function parseMarkdown(markdown: string): ParsedBlock[] {
  const lines = markdown.split(/\r?\n/);
  const blocks: ParsedBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      blocks.push({ kind: "blank" });
      i += 1;
      continue;
    }
    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    if (headingMatch) {
      blocks.push({
        kind: "heading",
        level: headingMatch[1].length,
        text: headingMatch[2].trim(),
      });
      i += 1;
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, "").trim());
        i += 1;
      }
      blocks.push({ kind: "list", items });
      continue;
    }
    if (/^\|/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\|/.test(lines[i])) {
        const row = lines[i]
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => c.trim());
        rows.push(row);
        i += 1;
      }
      // 去掉第二行的 markdown table 分隔
      const filtered = rows.filter(
        (row) => !/^[-:\s|]+$/.test(row.join(""))
      );
      if (filtered.length > 0) {
        blocks.push({ kind: "table", rows: filtered });
      }
      continue;
    }
    if (/^```/.test(line)) {
      const language = line.slice(3).trim();
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1;
      blocks.push({ kind: "code", language, text: code.join("\n") });
      continue;
    }
    blocks.push({ kind: "paragraph", text: line.trim() });
    i += 1;
  }
  return blocks;
}

const HEADING_LEVELS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
];

function buildParagraph(text: string, opts: { bold?: boolean } = {}): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, bold: opts.bold })],
  });
}

function blockToDocx(block: ParsedBlock): (Paragraph | Table)[] {
  switch (block.kind) {
    case "heading":
      return [
        new Paragraph({
          heading: HEADING_LEVELS[Math.min(block.level ?? 1, 6) - 1],
          children: [new TextRun({ text: block.text ?? "", bold: true })],
        }),
      ];
    case "paragraph":
      return [buildParagraph(block.text ?? "")];
    case "list":
      return (block.items ?? []).map((item) =>
        new Paragraph({
          text: `• ${item}`,
          spacing: { before: 60, after: 60 },
        })
      );
    case "code":
      return [
        new Paragraph({
          shading: { type: ShadingType.CLEAR, fill: "F4F4F5" },
          children: [new TextRun({ text: block.text ?? "", font: "Consolas" })],
        }),
      ];
    case "table": {
      const rows = block.rows ?? [];
      if (rows.length === 0) return [];
      const table = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: rows.map(
          (row, idx) =>
            new TableRow({
              children: row.map(
                (cell) =>
                  new TableCell({
                    children: [
                      new Paragraph({
                        children: [
                          new TextRun({ text: cell, bold: idx === 0 }),
                        ],
                        alignment:
                          idx === 0 ? AlignmentType.LEFT : AlignmentType.LEFT,
                      }),
                    ],
                  })
              ),
            })
        ),
      });
      return [table];
    }
    case "blank":
      return [new Paragraph({ children: [new TextRun({ text: "" })] })];
    default:
      return [];
  }
}

export async function exportArtifactAsDocx(
  userId: string,
  artifactId: string
): Promise<Record<string, unknown>> {
  const artifact = await prisma.artifact.findFirst({
    where: { id: artifactId, userId },
    select: { id: true, title: true, content: true, type: true },
  });
  if (!artifact) {
    return { error: "ARTIFACT_NOT_FOUND" };
  }
  try {
    const blocks = parseMarkdown(artifact.content);
    const docxChildren: (Paragraph | Table)[] = [];
    for (const block of blocks) {
      docxChildren.push(...blockToDocx(block));
    }
    const doc = new Document({
      creator: "LumenLab Agent",
      title: artifact.title,
      sections: [
        {
          properties: {},
          children: docxChildren,
        },
      ],
    });
    const buffer = await Packer.toBuffer(doc);
    const base64 = Buffer.from(buffer).toString("base64");
    return {
      artifactId: artifact.id,
      title: artifact.title,
      format: "docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      base64,
      bytes: buffer.byteLength,
    };
  } catch (error) {
    logger.error("docx export failed", { error: String(error) });
    return { error: "EXPORT_FAILED" };
  }
}