import crypto from "crypto";
import type { DocumentBlock, ParsedAsset } from "../types";

const HORIZONTAL_RULE_REGEX = /^(?:-{3,}|\*{3,}|_{3,})$/;
const TABLE_SEPARATOR_REGEX = /^\|?[-:|\s]+\|?$/;
const HEADING_REGEX = /^(#{1,6})\s+(.+)$/;
const IMAGE_REGEX = /!\[([^\]]*)\]\(([^)]+)\)/;

export function markdownToBlocks(markdown: string): DocumentBlock[] {
  const lines = markdown.split("\n");
  const blocks: DocumentBlock[] = [];
  let buffer: string[] = [];

  function flushText() {
    const text = buffer.join("\n").trim();
    if (text) {
      blocks.push({
        type: "text",
        id: crypto.randomUUID(),
        content: text,
      });
    }
    buffer = [];
  }

  let i = 0;
  while (i < lines.length) {
    const rawLine = lines[i];
    const line = rawLine; // preserve indentation for code/text

    // Heading
    const headingMatch = line.match(HEADING_REGEX);
    if (headingMatch) {
      flushText();
      blocks.push({
        type: "heading",
        id: crypto.randomUUID(),
        level: headingMatch[1].length,
        content: headingMatch[2].trim(),
      });
      i++;
      continue;
    }

    // Code fence
    if (line.startsWith("```")) {
      flushText();
      const language = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      blocks.push({
        type: "code",
        id: crypto.randomUUID(),
        language: language || undefined,
        content: codeLines.join("\n"),
      });
      i++; // skip closing fence
      continue;
    }

    // Table (simple heuristic: line contains | and next line is separator)
    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      TABLE_SEPARATOR_REGEX.test(lines[i + 1])
    ) {
      flushText();
      const tableLines: string[] = [line];
      i++;
      while (i < lines.length && lines[i].includes("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      blocks.push({
        type: "table",
        id: crypto.randomUUID(),
        markdown: tableLines.join("\n"),
      });
      continue;
    }

    // Image
    const imageMatch = line.match(IMAGE_REGEX);
    if (imageMatch) {
      flushText();
      blocks.push({
        type: "image",
        id: crypto.randomUUID(),
        assetId: "", // filled by caller
        relativePath: imageMatch[2].trim(),
        altText: imageMatch[1].trim() || undefined,
        analysisStatus: "pending",
      });
      i++;
      continue;
    }

    // Formula
    const trimmed = line.trim();
    if (trimmed.startsWith("$$")) {
      flushText();
      if (trimmed.endsWith("$$") && trimmed.length > 4) {
        // Single-line display formula
        blocks.push({
          type: "formula",
          id: crypto.randomUUID(),
          content: trimmed.slice(2, -2).trim(),
        });
        i++;
        continue;
      }

      // Multi-line display formula
      const formulaLines: string[] = [line];
      i++;
      while (i < lines.length && !lines[i].trim().endsWith("$$")) {
        formulaLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) {
        formulaLines.push(lines[i]);
        i++;
      }
      const joined = formulaLines.join("\n");
      const firstDouble = joined.indexOf("$$");
      const lastDouble = joined.lastIndexOf("$$");
      const content =
        firstDouble >= 0 && lastDouble > firstDouble
          ? joined.slice(firstDouble + 2, lastDouble).trim()
          : joined.trim();
      blocks.push({
        type: "formula",
        id: crypto.randomUUID(),
        content,
      });
      continue;
    }

    // Horizontal rule / page break
    if (HORIZONTAL_RULE_REGEX.test(line.trim())) {
      flushText();
      blocks.push({ type: "page-break", id: crypto.randomUUID() });
      i++;
      continue;
    }

    buffer.push(line);
    i++;
  }

  flushText();
  return blocks;
}

export function assignAssetIdsToImageBlocks(
  blocks: DocumentBlock[],
  assetMap: Map<string, ParsedAsset>
): void {
  for (const block of blocks) {
    if (block.type !== "image") continue;
    const asset = assetMap.get(block.relativePath);
    if (asset) {
      block.assetId = asset.id;
    }
  }
}
