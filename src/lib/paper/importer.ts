import { createHash } from "node:crypto";
import AdmZip from "adm-zip";
import { buildEmptyAcademicDocument, type AcademicDocument, type DocumentBlock, type InlineNode } from "./document-schema";

export type PaperImportSourceType = "docx" | "markdown" | "txt" | "latex";

export interface PaperImportResult {
  document: AcademicDocument;
  assets: PaperImportAsset[];
  report: {
    parserVersion: string;
    sourceType: PaperImportSourceType;
    warnings: string[];
    lowConfidenceBlocks: Array<{ index: number; reason: string }>;
    blockCount: number;
  };
}

export interface PaperImportAsset {
  placeholderId: string;
  originalName: string;
  mimeType: string;
  buffer: Buffer;
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
    assets: [],
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
    assets: [],
    report: { parserVersion: PARSER_VERSION, sourceType: "latex", warnings, lowConfidenceBlocks, blockCount: blocks.length },
  };
}

function decodeXml(value: string): string {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function docxText(inner: string) {
  return decodeXml([...inner.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((item) => item[1]).join(" ")).replace(/\s+/g, " ").trim();
}

function docxFootnotes(archive: AdmZip) {
  const xml = archive.getEntry("word/footnotes.xml")?.getData().toString("utf8") ?? "";
  const notes = new Map<string, string>();
  for (const match of xml.matchAll(/<w:footnote\b[^>]*w:id="(-?\d+)"[^>]*>([\s\S]*?)<\/w:footnote>/g)) {
    const value = docxText(match[2]);
    if (value) notes.set(match[1], value);
  }
  return notes;
}

function docxRelationships(archive: AdmZip) {
  const xml = archive.getEntry("word/_rels/document.xml.rels")?.getData().toString("utf8") ?? "";
  return new Map([...xml.matchAll(/<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*\/?>(?:<\/Relationship>)?/g)].map((match) => [match[1], match[2]]));
}

function docxMediaPath(target: string) {
  const normalized = target.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\//, "");
  return normalized.startsWith("word/") ? normalized : `word/${normalized}`;
}

function docxMimeType(name: string) {
  const extension = name.toLowerCase().split(".").pop();
  return extension === "jpg" || extension === "jpeg" ? "image/jpeg" : extension === "gif" ? "image/gif" : extension === "svg" ? "image/svg+xml" : "image/png";
}

function docxTable(inner: string, index: number): Extract<DocumentBlock, { kind: "table" }> | null {
  const rows = [...inner.matchAll(/<w:tr(?:\s[^>]*)?>([\s\S]*?)<\/w:tr>/g)].map((row) => [...row[1].matchAll(/<w:tc(?:\s[^>]*)?>([\s\S]*?)<\/w:tc>/g)].map((cell) => docxText(cell[1])));
  const normalizedRows = rows.filter((row) => row.length > 0);
  if (!normalizedRows.length || !normalizedRows[0].length) return null;
  const columns = normalizedRows[0].map((cell, column) => cell || `列 ${column + 1}`);
  return { kind: "table", id: idFor("table", normalizedRows.flat().join("\n"), index), columns, rows: normalizedRows.slice(1), caption: undefined };
}

function docxEquation(inner: string, index: number): Extract<DocumentBlock, { kind: "equation" }> | null {
  if (!/<m:oMath(?:Para)?\b/.test(inner)) return null;
  const value = decodeXml([...inner.matchAll(/<m:t(?:\s[^>]*)?>([\s\S]*?)<\/m:t>/g)].map((match) => match[1]).join(" ")).replace(/\s+/g, " ").trim();
  if (!value) return null;
  return { kind: "equation", id: idFor("equation", value, index), latex: value };
}

function fromDocx(input: { buffer: Buffer; filename: string }): PaperImportResult {
  const archive = new AdmZip(input.buffer);
  const xml = archive.readAsText("word/document.xml");
  const body = /<w:body(?:\s[^>]*)?>([\s\S]*?)<\/w:body>/.exec(xml)?.[1] ?? xml;
  const blocks: DocumentBlock[] = [];
  const assets: PaperImportAsset[] = [];
  const warnings: string[] = [];
  const lowConfidenceBlocks: Array<{ index: number; reason: string }> = [];
  const relationships = docxRelationships(archive);
  const footnotes = docxFootnotes(archive);
  const assetsByPath = new Map<string, PaperImportAsset>();
  let firstHeading: string | undefined;
  let tokenIndex = 0;
  const tokens = body.match(/<w:p\b[\s\S]*?<\/w:p>|<w:tbl\b[\s\S]*?<\/w:tbl>/g) ?? [];
  for (const token of tokens) {
    const isTable = token.startsWith("<w:tbl");
    if (isTable) {
      const table = docxTable(token, tokenIndex++);
      if (table) blocks.push(table);
      continue;
    }
    const inner = /^<w:p\b[^>]*>([\s\S]*)<\/w:p>$/.exec(token)?.[1] ?? token;
    const value = docxText(inner);
    const style = /<w:pStyle[^>]*w:val="([^"]+)"/.exec(inner)?.[1]?.toLowerCase() ?? "";
    const headingMatch = /heading\s*([1-6])/.exec(style);
    const equation = docxEquation(inner, tokenIndex++);
    if (equation) {
      blocks.push(equation);
      lowConfidenceBlocks.push({ index: blocks.length - 1, reason: "DOCX OMML 公式已提取，但复杂结构仍需核对 LaTeX 转换" });
      continue;
    }
    const footnoteIds = [...inner.matchAll(/<w:footnoteReference[^>]*w:id="(-?\d+)"[^>]*\/?>(?:<\/w:footnoteReference>)?/g)].map((match) => match[1]);
    const inline: InlineNode[] = value ? [{ kind: "text", text: value }] : [];
    for (const footnoteId of footnoteIds) {
      inline.push({ kind: "footnote", id: `footnote-${footnoteId}`, children: text(footnotes.get(footnoteId) ?? "脚注内容待核对") });
    }
    if (headingMatch && value) {
      firstHeading ??= value;
      blocks.push({ kind: "heading", id: idFor("heading", value, tokenIndex), level: Number(headingMatch[1]), children: inline.length ? inline : text(value) });
    } else if (value || inline.length) {
      const list = /<w:numPr\b/.test(inner);
      blocks.push(list ? { kind: "list", id: idFor("list", value, tokenIndex), ordered: false, items: [inline.length ? inline : text(value)] } : { kind: "paragraph", id: idFor("paragraph", value, tokenIndex), children: inline.length ? inline : text(value) });
    }

    const imageRefs = [...inner.matchAll(/r:(?:embed|link)="([^"]+)"/g)].map((match) => match[1]);
    for (const imageRef of imageRefs) {
      const target = relationships.get(imageRef);
      if (!target) continue;
      const mediaPath = docxMediaPath(target);
      const entry = archive.getEntry(mediaPath);
      if (!entry) continue;
      let asset = assetsByPath.get(mediaPath);
      if (!asset) {
        asset = { placeholderId: idFor("docx-asset", mediaPath, assets.length), originalName: mediaPath.split("/").pop() ?? `image-${assets.length}.png`, mimeType: docxMimeType(mediaPath), buffer: entry.getData() };
        assetsByPath.set(mediaPath, asset);
        assets.push(asset);
      }
      const description = decodeXml(/<wp:docPr[^>]*(?:descr|name)="([^"]+)"/.exec(inner)?.[1] ?? "").trim();
      blocks.push({ kind: "figure", id: idFor("figure", asset.placeholderId, blocks.length), assetId: asset.placeholderId, caption: description, alignment: "center", placement: "float" });
      if (!description) lowConfidenceBlocks.push({ index: blocks.length - 1, reason: "DOCX 图片缺少明确图注，需确认 Figure、正文内图片或装饰资源" });
    }
    if (/<w:drawing\b|<w:object\b/.test(inner) && imageRefs.length === 0) {
      warnings.push("DOCX 中检测到未解析的嵌入对象");
      lowConfidenceBlocks.push({ index: Math.max(0, blocks.length - 1), reason: "DOCX 图片或嵌入对象没有可解析的媒体关系" });
    }
    if (footnoteIds.some((id) => !footnotes.has(id))) {
      warnings.push("部分 DOCX 脚注缺少对应 footnotes.xml 内容");
    }
  }
  if (!blocks.length) {
    warnings.push("DOCX 未找到可识别段落、表格、图片或公式");
    lowConfidenceBlocks.push({ index: 0, reason: "DOCX 中未找到可识别的结构块" });
  }
  const title = normalizeTitle(input.filename, firstHeading);
  return { document: { ...buildEmptyAcademicDocument(title), blocks: [metadata(title), ...blocks] }, assets, report: { parserVersion: `${PARSER_VERSION}+docx-structure-v2`, sourceType: "docx", warnings, lowConfidenceBlocks, blockCount: blocks.length } };
}

export function parsePaperImport(input: { filename: string; buffer: Buffer }): PaperImportResult {
  const lower = input.filename.toLowerCase();
  if (lower.endsWith(".docx")) return fromDocx(input);
  const content = input.buffer.toString("utf8");
  if (lower.endsWith(".tex")) return fromLatex({ content, filename: input.filename });
  if (lower.endsWith(".md") || lower.endsWith(".markdown") || lower.endsWith(".txt")) return fromMarkdown({ content, filename: input.filename });
  throw new Error("仅支持 DOCX、Markdown、TXT 和 LaTeX 导入");
}
