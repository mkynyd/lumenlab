import crypto from "crypto";
import type { DocumentBlock, ParsedAsset } from "../types";

const HORIZONTAL_RULE_REGEX = /^\s*(?:(?:-\s*){3,}|\*{3,}|_{3,})\s*$/;
const TABLE_SEPARATOR_REGEX = /^\|?[-:|\s]+\|?$/;
const HEADING_REGEX = /^(#{1,6})\s+(.+)$/;
const IMAGE_REGEX = /^!\[([^\]]*)\]\((.+?)(?:\s+(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'))?\)$/;

function unescapeMarkdownPath(path: string): string {
  return path.replace(/\\(.)/g, "$1");
}

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

    // Table (simple heuristic: line looks like a header and next line is separator)
    const pipeCount = line.split("|").length - 1;
    const looksLikeTableHeader =
      (line.startsWith("|") && line.endsWith("|")) || pipeCount >= 2;
    if (
      looksLikeTableHeader &&
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

    // Image (only standalone lines that are exactly an image reference)
    const imageMatch = line.match(IMAGE_REGEX);
    if (imageMatch) {
      flushText();
      blocks.push({
        type: "image",
        id: crypto.randomUUID(),
        assetId: "", // filled by caller
        relativePath: unescapeMarkdownPath(imageMatch[2].trim()),
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

      // Slice using the known opening/closing boundaries so internal $$ is preserved.
      const firstLine = formulaLines[0];
      const lastLine = formulaLines[formulaLines.length - 1];
      const startIdx = firstLine.indexOf("$$");
      const endIdx = lastLine.lastIndexOf("$$");
      const firstPart = startIdx >= 0 ? firstLine.slice(startIdx + 2).trim() : firstLine.trim();
      const lastPart = endIdx >= 0 ? lastLine.slice(0, endIdx).trim() : lastLine.trim();
      const middleParts = formulaLines.slice(1, -1);
      const content = [firstPart, ...middleParts, lastPart]
        .filter((part) => part.length > 0)
        .join("\n")
        .trim();
      blocks.push({
        type: "formula",
        id: crypto.randomUUID(),
        content,
      });
      continue;
    }

    // Horizontal rule / page break
    if (HORIZONTAL_RULE_REGEX.test(line)) {
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
