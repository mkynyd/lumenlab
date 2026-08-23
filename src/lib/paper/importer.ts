import { createHash } from "node:crypto";
import AdmZip from "adm-zip";
import { buildEmptyAcademicDocument, type AcademicDocument, type DocumentBlock, type InlineNode } from "./document-schema";

export type PaperImportSourceType = "docx" | "markdown" | "txt" | "latex";

export interface PaperImportResult {
  document: AcademicDocument;
  report: {
    parserVersion: string;
    sourceType: PaperImportSourceType;
    warnings: string[];
    lowConfidenceBlocks: Array<{ index: number; reason: string }>;
    blockCount: number;
  };
}

const PARSER_VERSION = "paper-import-v1";

function text(value: string): InlineNode[] {
  return [{ kind: "text", text: value }];
}

function idFor(prefix: string, value: string, index: number): string {
  const hash = createHash("sha1").update(`${prefix}:${index}:${value}`).digest("hex").slice(0, 12);
  return `${prefix}-${hash}`;
}

function metadata(title: string): DocumentBlock {
  return { kind: "paper_metadata", title: title || "未命名论文", authors: ["作者"] };
}

function normalizeTitle(filename: string, firstHeading?: string): string {
  return firstHeading?.trim() || filename.replace(/\.(docx|md|markdown|txt|tex)$/i, "").trim() || "未命名论文";
}

function fromMarkdown(input: { content: string; filename: string }): PaperImportResult {
  const lines = input.content.replace(/\r\n?/g, "\n").split("\n");
  const blocks: DocumentBlock[] = [];
  const warnings: string[] = [];
  const lowConfidenceBlocks: Array<{ index: number; reason: string }> = [];
  let firstHeading: string | undefined;
  let paragraph: string[] = [];
  let listItems: string[] = [];
  let listOrdered = false;
  let inFence = false;
  let fenceLines: string[] = [];

  const flushParagraph = () => {
    const value = paragraph.join(" ").replace(/\s+/g, " ").trim();
    if (value) blocks.push({ kind: "paragraph", id: idFor("paragraph", value, blocks.length), children: text(value) });
    paragraph = [];
  };
  const flushList = () => {
    if (!listItems.length) return;
    blocks.push({ kind: "list", id: idFor("list", listItems.join("\n"), blocks.length), ordered: listOrdered, items: listItems.map(text) });
    listItems = [];
  };
  const flushFence = () => {
    if (!fenceLines.length) return;
    blocks.push({ kind: "raw_latex", id: idFor("raw", fenceLines.join("\n"), blocks.length), latex: fenceLines.join("\n") });
    lowConfidenceBlocks.push({ index: blocks.length - 1, reason: "代码围栏无法确定为论文正文、公式或原始 LaTeX" });
    fenceLines = [];
  };

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      flushParagraph();
      flushList();
      if (inFence) flushFence();
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      fenceLines.push(line);
      continue;
    }
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      const value = heading[2].trim();
      firstHeading ??= value;
      if (/^(摘要|abstract)$/i.test(value)) {
        blocks.push({ kind: "abstract", language: /abstract/i.test(value) ? "en" : "zh", children: [] });
      } else if (/^(关键词|keywords?)$/i.test(value)) {
        blocks.push({ kind: "keywords", language: /keywords?/i.test(value) ? "en" : "zh", keywords: [] });
      } else {
        blocks.push({ kind: "heading", id: idFor("heading", value, blocks.length), level, children: text(value) });
      }
      continue;
    }
    const list = /^\s*([-*]|\d+[.)])\s+(.+)$/.exec(line);
    if (list) {
      flushParagraph();
      const ordered = /^\d/.test(list[1]);
      if (listItems.length && ordered !== listOrdered) flushList();
      listOrdered = ordered;
      listItems.push(list[2].trim());
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  if (inFence) {
    warnings.push("文档末尾缺少代码围栏结束标记，已按 RawLaTeXBlock 保留");
    flushFence();
  }

  return {
    document: { ...buildEmptyAcademicDocument(normalizeTitle(input.filename, firstHeading)), blocks: [metadata(normalizeTitle(input.filename, firstHeading)), ...blocks] },
    report: { parserVersion: PARSER_VERSION, sourceType: input.filename.toLowerCase().endsWith(".txt") ? "txt" : "markdown", warnings, lowConfidenceBlocks, blockCount: blocks.length },
  };
}

function fromLatex(input: { content: string; filename: string }): PaperImportResult {
  const content = input.content.replace(/\r\n?/g, "\n");
  const blocks: DocumentBlock[] = [];
  const warnings: string[] = [];
  const lowConfidenceBlocks: Array<{ index: number; reason: string }> = [];
  const title = /\\title\s*\{([^}]*)\}/.exec(content)?.[1]?.trim() || normalizeTitle(input.filename);
  const abstract = /\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/i.exec(content)?.[1]?.trim();
  if (abstract) blocks.push({ kind: "abstract", language: "en", children: text(abstract) });
  const sectionRe = /\\(section|subsection|subsubsection|paragraph)\s*\{([^}]*)\}([\s\S]*?)(?=\\(?:section|subsection|subsubsection|paragraph)\s*\{|\\end\{document\}|$)/g;
  let match: RegExpExecArray | null;
  while ((match = sectionRe.exec(content)) !== null) {
    const level = match[1] === "section" ? 1 : match[1] === "subsection" ? 2 : match[1] === "subsubsection" ? 3 : 4;
    const heading = match[2].trim();
    blocks.push({ kind: "heading", id: idFor("heading", heading, blocks.length), level, children: text(heading) });
    const body = match[3].replace(/\\label\s*\{[^}]*\}/g, "").trim();
    if (body) blocks.push({ kind: "paragraph", id: idFor("paragraph", body, blocks.length), children: text(body.replace(/\\[a-zA-Z]+\s*/g, "").replace(/[{}]/g, "")) });
  }
  if (!blocks.length && content.trim()) {
    blocks.push({ kind: "raw_latex", id: idFor("raw", content, 0), latex: content });
    lowConfidenceBlocks.push({ index: 0, reason: "未识别的 LaTeX 宏或环境，原样保留" });
    warnings.push("未识别的 LaTeX 结构已保存在 RawLaTeXBlock 中");
  }
  return {
    document: { ...buildEmptyAcademicDocument(title), blocks: [metadata(title), ...blocks] },
    report: { parserVersion: PARSER_VERSION, sourceType: "latex", warnings, lowConfidenceBlocks, blockCount: blocks.length },
  };
}

function decodeXml(value: string): string {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function fromDocx(input: { buffer: Buffer; filename: string }): PaperImportResult {
  const archive = new AdmZip(input.buffer);
  const xml = archive.readAsText("word/document.xml");
  const blocks: DocumentBlock[] = [];
  const warnings: string[] = [];
  const lowConfidenceBlocks: Array<{ index: number; reason: string }> = [];
  const paragraphs = [...xml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)];
  let firstHeading: string | undefined;
  for (const [index, paragraph] of paragraphs.entries()) {
    const inner = paragraph[1];
    const value = decodeXml([...inner.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((item) => item[1]).join(" ")).replace(/\s+/g, " ").trim();
    if (!value) continue;
    const style = /<w:pStyle[^>]*w:val="([^"]+)"/.exec(inner)?.[1]?.toLowerCase() ?? "";
    const headingMatch = /heading\s*([1-6])/.exec(style);
    if (headingMatch) {
      firstHeading ??= value;
      blocks.push({ kind: "heading", id: idFor("heading", value, index), level: Number(headingMatch[1]), children: text(value) });
    } else {
      blocks.push({ kind: "paragraph", id: idFor("paragraph", value, index), children: text(value) });
    }
  }
  if (xml.includes("<w:drawing") || xml.includes("<w:object")) warnings.push("DOCX 图片已检测到，但首轮导入只保留文字结构，图片需在结构确认后重新绑定 Asset");
  if (!blocks.length) {
    warnings.push("DOCX 未找到可识别段落");
    lowConfidenceBlocks.push({ index: 0, reason: "DOCX 中未找到可识别的段落结构" });
  }
  const title = normalizeTitle(input.filename, firstHeading);
  return { document: { ...buildEmptyAcademicDocument(title), blocks: [metadata(title), ...blocks] }, report: { parserVersion: PARSER_VERSION, sourceType: "docx", warnings, lowConfidenceBlocks, blockCount: blocks.length } };
}

export function parsePaperImport(input: { filename: string; buffer: Buffer }): PaperImportResult {
  const lower = input.filename.toLowerCase();
  if (lower.endsWith(".docx")) return fromDocx(input);
  const content = input.buffer.toString("utf8");
  if (lower.endsWith(".tex")) return fromLatex({ content, filename: input.filename });
  if (lower.endsWith(".md") || lower.endsWith(".markdown") || lower.endsWith(".txt")) return fromMarkdown({ content, filename: input.filename });
  throw new Error("仅支持 DOCX、Markdown、TXT 和 LaTeX 导入");
}
