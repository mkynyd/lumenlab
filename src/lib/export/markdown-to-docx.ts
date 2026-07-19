import {
  BorderStyle,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  type ParagraphChild,
  Table,
  TableCell,
  TableRow,
  TextRun,
} from "docx";
import type { Content, PhrasingContent, Root } from "mdast";
import sharp from "sharp";
import { markdownNodeText, parseMarkdown } from "@/lib/export/markdown-ast";

export type ResolveImage = (
  src: string
) => Promise<{ buffer: Buffer; mimeType: string } | null>;

async function imageRun(
  src: string,
  alt: string,
  resolveImage?: ResolveImage
): Promise<ImageRun | TextRun> {
  const resolved = await resolveImage?.(src);
  if (!resolved) return new TextRun(alt || src);

  const image = sharp(resolved.buffer, { animated: false });
  const metadata = await image.metadata();
  const png = await image.png().toBuffer();
  const sourceWidth = metadata.width || 640;
  const sourceHeight = metadata.height || 480;
  const scale = Math.min(1, 560 / sourceWidth);
  return new ImageRun({
    type: "png",
    data: png,
    transformation: {
      width: Math.max(1, Math.round(sourceWidth * scale)),
      height: Math.max(1, Math.round(sourceHeight * scale)),
    },
    altText: {
      title: alt || "图片",
      description: alt || "图片",
      name: alt || "图片",
    },
  });
}

async function inlineRuns(
  nodes: PhrasingContent[],
  resolveImage?: ResolveImage
): Promise<ParagraphChild[]> {
  const runs: ParagraphChild[] = [];
  for (const node of nodes) {
    if (node.type === "text") {
      runs.push(new TextRun(node.value));
      continue;
    }
    if (node.type === "inlineCode") {
      runs.push(new TextRun({ text: node.value, font: "Courier New" }));
      continue;
    }
    if (node.type === "strong") {
      runs.push(new TextRun({ text: markdownNodeText(node), bold: true }));
      continue;
    }
    if (node.type === "emphasis") {
      runs.push(new TextRun({ text: markdownNodeText(node), italics: true }));
      continue;
    }
    if (node.type === "image") {
      runs.push(await imageRun(node.url, node.alt || "", resolveImage));
      continue;
    }
    if (node.type === "break") {
      runs.push(new TextRun({ text: "", break: 1 }));
      continue;
    }
    if ("children" in node) {
      runs.push(...(await inlineRuns(node.children as PhrasingContent[], resolveImage)));
      continue;
    }
    runs.push(new TextRun(markdownNodeText(node as unknown)));
  }
  return runs;
}

async function paragraphFromNode(
  node: Content,
  prefix = "",
  resolveImage?: ResolveImage
): Promise<Paragraph> {
  const children =
    "children" in node
      ? await inlineRuns(node.children as PhrasingContent[], resolveImage)
      : [new TextRun(markdownNodeText(node))];
  if (prefix) children.unshift(new TextRun(prefix));
  return new Paragraph({ children });
}

async function blocks(
  root: Root,
  resolveImage?: ResolveImage
): Promise<Array<Paragraph | Table>> {
  const output: Array<Paragraph | Table> = [];

  for (const node of root.children) {
    if (node.type === "heading") {
      const levels = {
        1: HeadingLevel.HEADING_1,
        2: HeadingLevel.HEADING_2,
        3: HeadingLevel.HEADING_3,
        4: HeadingLevel.HEADING_4,
        5: HeadingLevel.HEADING_5,
        6: HeadingLevel.HEADING_6,
      } as const;
      output.push(
        new Paragraph({
          heading: levels[node.depth],
          children: await inlineRuns(node.children, resolveImage),
        })
      );
    } else if (node.type === "paragraph") {
      output.push(await paragraphFromNode(node, "", resolveImage));
    } else if (node.type === "code") {
      output.push(
        new Paragraph({
          children: [
            new TextRun({
              text:
                node.lang === "mermaid"
                  ? `Mermaid 源码\n${node.value}`
                  : node.value,
              font: "Courier New",
            }),
          ],
          shading: { fill: "F3F4F6" },
        })
      );
    } else if (node.type === "blockquote") {
      for (const child of node.children) {
        output.push(await paragraphFromNode(child, "引用：", resolveImage));
      }
    } else if (node.type === "list") {
      for (const item of node.children) {
        for (const child of item.children) {
          output.push(
            new Paragraph({
              children:
                "children" in child
                  ? await inlineRuns(
                      child.children as PhrasingContent[],
                      resolveImage
                    )
                  : [new TextRun(markdownNodeText(child))],
              bullet: node.ordered ? undefined : { level: 0 },
              numbering: node.ordered
                ? { reference: "artifact-numbering", level: 0 }
                : undefined,
            })
          );
        }
      }
    } else if (node.type === "table") {
      const rows = [];
      for (const row of node.children) {
        const cells = [];
        for (const cell of row.children) {
          cells.push(
            new TableCell({
              children: [await paragraphFromNode(cell, "", resolveImage)],
            })
          );
        }
        rows.push(new TableRow({ children: cells }));
      }
      output.push(new Table({ rows }));
    } else if (node.type === "thematicBreak") {
      output.push(
        new Paragraph({
          border: {
            bottom: {
              color: "B8B8B8",
              style: BorderStyle.SINGLE,
              size: 4,
            },
          },
        })
      );
    } else {
      output.push(new Paragraph(markdownNodeText(node)));
    }
  }
  return output;
}

export async function legacyMarkdownToDocx(
  content: string,
  options: { resolveImage?: ResolveImage } = {}
): Promise<Buffer> {
  const document = new Document({
    numbering: {
      config: [
        {
          reference: "artifact-numbering",
          levels: [
            {
              level: 0,
              format: "decimal",
              text: "%1.",
              alignment: "start",
            },
          ],
        },
      ],
    },
    styles: {
      default: {
        document: {
          run: { font: "Noto Sans SC", size: 22 },
        },
      },
    },
    sections: [
      { children: await blocks(parseMarkdown(content), options.resolveImage) },
    ],
  });
  return Packer.toBuffer(document);
}

/**
 * Pandoc owns the production DOCX path. The previous renderer remains an
 * explicit emergency rollback only; it is intentionally not the default.
 */
export async function markdownToDocx(
  content: string,
  options: { resolveImage?: ResolveImage } = {}
): Promise<Buffer> {
  if (process.env.DOCX_EXPORT_ENGINE === "legacy") {
    return legacyMarkdownToDocx(content, options);
  }

  const { markdownToPandocDocx } = await import("@/lib/export/pandoc-docx");
  return markdownToPandocDocx(content, options);
}
