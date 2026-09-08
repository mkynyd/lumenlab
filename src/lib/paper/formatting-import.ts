import { createHash } from "node:crypto";
import AdmZip from "adm-zip";
import { JSDOM } from "jsdom";
import sharp from "sharp";
import type { Content, PhrasingContent } from "mdast";
import { parseMarkdown, markdownNodeText } from "@/lib/export/markdown-ast";
import { fetchPublicImage } from "@/lib/tools/web/fetch";
import { parseAcademicDocument, type DocumentBlock, type InlineNode } from "./document-schema";
import type { PaperImportResult, PaperImportAsset } from "./importer";
import { FormattingError, formattingSourceType, MAX_FORMATTING_SOURCE_BYTES, type FormattingMetadata } from "./formatting-contracts";

const MAX_EXPANDED_BYTES = 100 * 1024 * 1024;
const id = (prefix: string, index: number) => `${prefix}-${index}`;
const text = (value: string): InlineNode[] => [{ kind: "text", text: value }];
const childElements = (node: Element) => Array.from(node.children);
const all = (node: Element | Document, name: string) => Array.from(node.getElementsByTagNameNS("*", name));
const attr = (node: Element, name: string) => Array.from(node.attributes).find((a) => a.localName === name)?.value ?? "";
const unsupported = (message: string): never => { throw new FormattingError("SOURCE_UNSUPPORTED", `${message}。请在原稿中调整后重新上传；原稿不会被覆盖。`); };

async function normalizeImage(buffer: Buffer, index: number): Promise<PaperImportAsset> {
  if (buffer.byteLength > 10 * 1024 * 1024) throw new FormattingError("IMAGE_TOO_LARGE", "原稿中有超过 10 MB 的图片。");
  const image = sharp(buffer, { limitInputPixels: 40_000_000 });
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) throw new FormattingError("IMAGE_INVALID", "原稿图片无法读取。");
  // TeX consumes a lossless PNG while the unchanged source remains downloadable.
  const png = await image.png().toBuffer();
  return { placeholderId: id("image", index), originalName: `image-${index}.png`, mimeType: "image/png", buffer: png };
}

function markdownInline(nodes: PhrasingContent[], notes: Map<string, Content[]>, seen = new Set<string>()): InlineNode[] {
  return nodes.flatMap((node): InlineNode[] => {
    if (node.type === "text" || node.type === "inlineCode") return text(node.value);
    if (node.type === "inlineMath") return [{ kind: "inline_math", latex: node.value }];
    if (node.type === "break") return text("\n");
    if (node.type === "strong" || node.type === "emphasis") return [{ kind: node.type === "strong" ? "bold" : "italic", children: markdownInline(node.children, notes, seen) }];
    if (node.type === "footnoteReference") {
      const definition = notes.get(node.identifier);
      if (!definition || seen.has(node.identifier)) return unsupported("Markdown 脚注缺失或循环引用");
      const nested = new Set([...seen, node.identifier]);
      const paragraphs = definition.map((part) => part.type === "paragraph" ? markdownInline(part.children, notes, nested) : unsupported("脚注中包含当前不能保真的复杂块"));
      return [{ kind: "footnote", id: `footnote-${node.identifier}`, children: paragraphs.flatMap((p, i) => i ? [...text("\n"), ...p] : p) }];
    }
    if (node.type === "image" || node.type === "imageReference") return unsupported("图片位置尚未解析");
    if ("children" in node) return markdownInline(node.children as PhrasingContent[], notes, seen);
    if ("value" in node && typeof node.value === "string") return text(node.value);
    return unsupported(`Markdown 行内结构 ${node.type} 尚不支持`);
  });
}

async function markdownImport(buffer: Buffer, signal: AbortSignal): Promise<{ blocks: DocumentBlock[]; assets: PaperImportAsset[] }> {
  const root = parseMarkdown(new TextDecoder("utf-8", { fatal: true }).decode(buffer));
  const definitions = new Map(root.children.flatMap((node) => node.type === "definition" ? [[node.identifier, node.url] as const] : []));
  const notes = new Map(root.children.flatMap((node) => node.type === "footnoteDefinition" ? [[node.identifier, node.children as Content[]] as const] : []));
  const blocks: DocumentBlock[] = [];
  const assets: PaperImportAsset[] = [];
  const addParagraph = (nodes: PhrasingContent[]) => { if (nodes.length) blocks.push({ kind: "paragraph", id: id("paragraph", blocks.length), children: markdownInline(nodes, notes) }); };
  for (const node of root.children) {
    signal.throwIfAborted();
    if (node.type === "definition" || node.type === "footnoteDefinition") continue;
    if (node.type === "heading") { blocks.push({ kind: "heading", id: id("heading", blocks.length), level: node.depth, children: markdownInline(node.children, notes) }); continue; }
    if (node.type === "paragraph") {
      let inline: PhrasingContent[] = [];
      for (const part of node.children) {
        if (part.type !== "image" && part.type !== "imageReference") { inline.push(part); continue; }
        addParagraph(inline); inline = [];
        const url = part.type === "image" ? part.url : definitions.get(part.identifier);
        if (!url || !/^https?:\/\//i.test(url)) throw new FormattingError("MISSING_IMAGE", `图片“${part.alt || url || "未命名"}”使用本地或缺失路径。请将图片嵌入 DOCX 后上传，或改用可访问的公共图片链接。`);
        if (assets.length >= 100) throw new FormattingError("TOO_MANY_IMAGES", "原稿最多支持 100 张图片。");
        const remote = await fetchPublicImage(url, signal).catch(() => { throw new FormattingError("IMAGE_UNAVAILABLE", `无法安全读取图片“${part.alt || "未命名"}”，请将图片嵌入 DOCX 后上传。`); });
        const asset = await normalizeImage(remote.buffer, assets.length);
        assets.push(asset);
        blocks.push({ kind: "figure", id: id("figure", blocks.length), assetId: asset.placeholderId, caption: part.alt || "", alignment: "center", placement: "here" });
      }
      addParagraph(inline); continue;
    }
    if (node.type === "math") { blocks.push({ kind: "equation", id: id("equation", blocks.length), latex: node.value }); continue; }
    if (node.type === "table") {
      if (node.children.some((row) => row.children.some((cell) => cell.children.some((c) => c.type !== "text" && c.type !== "inlineCode")))) return unsupported("表格单元格包含复杂公式或富文本");
      const rows = node.children.map((row) => row.children.map(markdownNodeText));
      if (rows.length < 2 || rows[0].some((v) => !v.trim())) return unsupported("表格缺少有效表头或数据行");
      blocks.push({ kind: "table", id: id("table", blocks.length), columns: rows[0], rows: rows.slice(1) }); continue;
    }
    if (node.type === "list") {
      for (const item of node.children) if (item.children.length !== 1 || item.children[0].type !== "paragraph") return unsupported("嵌套列表需要先整理为单层列表");
      blocks.push({ kind: "list", id: id("list", blocks.length), ordered: node.ordered === true, items: node.children.map((item) => markdownInline((item.children[0] as Extract<Content, { type: "paragraph" }>).children, notes)) }); continue;
    }
    if (node.type === "blockquote") {
      if (node.children.some((part) => part.type !== "paragraph")) return unsupported("引用块内的复杂结构尚不支持");
      blocks.push({ kind: "quote", id: id("quote", blocks.length), children: node.children.flatMap((part, i) => [...(i ? text("\n") : []), ...markdownInline((part as Extract<Content, { type: "paragraph" }>).children, notes)]) }); continue;
    }
    if (node.type === "thematicBreak") { blocks.push({ kind: "page_break", id: id("break", blocks.length) }); continue; }
    if (node.type === "code" || node.type === "html") { blocks.push({ kind: "paragraph", id: id("literal", blocks.length), children: text(node.value) }); continue; }
    return unsupported(`Markdown 结构 ${node.type} 尚不支持`);
  }
  return { blocks, assets };
}

/** Restricted OMML translator: unknown operators fail closed instead of flattening fractions. */
function omml(node: Element): string {
  const children = childElements(node);
  const part = (name: string) => { const el = children.find((c) => c.localName === name); return el ? omml(el) : ""; };
  switch (node.localName) {
    case "t": return (node.textContent ?? "").replace(/[{}%#&_$\\]/g, (c) => `\\${c}`);
    case "oMath": case "oMathPara": case "e": case "num": case "den": case "sub": case "sup": case "deg": case "r": return children.filter((c) => !c.localName.endsWith("Pr")).map(omml).join("");
    case "f": return `\\frac{${part("num")}}{${part("den")}}`;
    case "sSup": return `{${part("e")}}^{${part("sup")}}`;
    case "sSub": return `{${part("e")}}_{${part("sub")}}`;
    case "sSubSup": return `{${part("e")}}_{${part("sub")}}^{${part("sup")}}`;
    case "rad": return `\\sqrt${part("deg") ? `[${part("deg")}]` : ""}{${part("e")}}`;
    default: return unsupported(`公式包含尚未支持的 OMML 运算 ${node.localName}`);
  }
}

async function docxImport(buffer: Buffer): Promise<{ blocks: DocumentBlock[]; assets: PaperImportAsset[] }> {
  const archive = new AdmZip(buffer);
  const entries = archive.getEntries();
  if (entries.length > 3000 || entries.reduce((sum, entry) => sum + entry.header.size, 0) > MAX_EXPANDED_BYTES) throw new FormattingError("DOCX_TOO_LARGE", "DOCX 解压后超过处理限制。");
  const xml = archive.readAsText("word/document.xml");
  if (!xml || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new FormattingError("DOCX_INVALID", "文件不是有效的 DOCX 原稿。");
  const parseXml = (value: string) => new JSDOM(value, { contentType: "text/xml" }).window.document;
  const doc = parseXml(xml);
  if (all(doc, "del").length || all(doc, "ins").length || all(doc, "altChunk").length) return unsupported("原稿包含未接受的修订或外部嵌入内容");
  const relationshipsXml = archive.readAsText("word/_rels/document.xml.rels");
  const relationships = new Map(relationshipsXml ? all(parseXml(relationshipsXml), "Relationship").map((el) => [attr(el, "Id"), { target: attr(el, "Target"), external: attr(el, "TargetMode") === "External" }]) : []);
  const footnotesXml = archive.readAsText("word/footnotes.xml");
  const footnotes = new Map(footnotesXml ? all(parseXml(footnotesXml), "footnote").map((el) => [attr(el, "id"), el]) : []);
  const blocks: DocumentBlock[] = [];
  const assets: PaperImportAsset[] = [];
  function inline(node: Element, seen = new Set<string>()): InlineNode[] {
    const output: InlineNode[] = [];
    for (const el of childElements(node)) {
      const name = el.localName;
      if (name === "t") output.push(...text(el.textContent ?? ""));
      else if (name === "tab") output.push(...text("\t"));
      else if (name === "br" || name === "cr") output.push(...text("\n"));
      else if (name === "oMath") output.push({ kind: "inline_math", latex: omml(el) });
      else if (name === "footnoteReference") {
        const noteId = attr(el, "id"); const note = footnotes.get(noteId);
        if (!note || seen.has(noteId)) return unsupported("DOCX 脚注缺失或循环引用");
        output.push({ kind: "footnote", id: `footnote-${noteId}`, children: inline(note, new Set([...seen, noteId])) });
      } else if (name === "r") {
        let content = inline(el, seen);
        const properties = childElements(el).find((c) => c.localName === "rPr");
        if (properties && all(properties, "b").some((b) => !["0", "false"].includes(attr(b, "val")))) content = content.length ? [{ kind: "bold", children: content }] : [];
        if (properties && all(properties, "i").some((i) => !["0", "false"].includes(attr(i, "val")))) content = content.length ? [{ kind: "italic", children: content }] : [];
        output.push(...content);
      } else if (!["pPr", "rPr", "drawing", "footnoteRef", "bookmarkStart", "bookmarkEnd", "proofErr", "sectPr", "oMathPara"].includes(name)) output.push(...inline(el, seen));
    }
    return output;
  }
  const body = all(doc, "body")[0];
  if (!body) throw new FormattingError("DOCX_INVALID", "DOCX 缺少正文。");
  for (const node of childElements(body)) {
    if (node.localName === "sectPr") continue;
    if (node.localName === "tbl") {
      if (all(node, "gridSpan").length || all(node, "vMerge").length || all(node, "oMath").length || all(node, "drawing").length) return unsupported("DOCX 表格包含合并单元格、公式或嵌套图片");
      const rows = childElements(node).filter((n) => n.localName === "tr").map((row) => childElements(row).filter((n) => n.localName === "tc").map((cell) => all(cell, "t").map((t) => t.textContent ?? "").join("")));
      if (rows.length < 2 || rows[0].some((v) => !v.trim()) || rows.some((row) => row.length !== rows[0].length)) return unsupported("DOCX 表格缺少完整表头或数据行");
      blocks.push({ kind: "table", id: id("table", blocks.length), columns: rows[0], rows: rows.slice(1) }); continue;
    }
    if (node.localName !== "p") return unsupported(`DOCX 正文结构 ${node.localName} 尚不支持`);
    if (all(node, "object").length || all(node, "pict").length) return unsupported("DOCX 中的旧式嵌入对象尚不能保真导入");
    const equations = all(node, "oMathPara");
    const children = inline(node);
    // Process mixed equation/text paragraphs without dropping their text.
    if (children.length) {
      const style = all(node, "pStyle")[0];
      const heading = style ? /(?:heading|标题)\s*([1-6])/i.exec(attr(style, "val")) : null;
      if (heading) blocks.push({ kind: "heading", id: id("heading", blocks.length), level: Number(heading[1]), children });
      else if (all(node, "numPr").length) blocks.push({ kind: "list", id: id("list", blocks.length), ordered: true, items: [children] });
      else blocks.push({ kind: "paragraph", id: id("paragraph", blocks.length), children });
    }
    if (equations.length && children.length) return unsupported("同一段落混合了独立公式和正文，请将公式另起一段");
    for (const equation of equations) blocks.push({ kind: "equation", id: id("equation", blocks.length), latex: omml(equation) });
    const drawings = all(node, "drawing");
    if (drawings.length && children.length) return unsupported("同一段落混合了图片和正文，请将图片另起一段");
    for (const drawing of drawings) {
      const image = all(drawing, "blip")[0];
      const rel = image ? relationships.get(attr(image, "embed")) : undefined;
      if (!rel || rel.external || rel.target.includes("..")) return unsupported("DOCX 图片缺少本地媒体或使用外部链接");
      const path = rel.target.replace(/^\//, ""); const mediaPath = path.startsWith("word/") ? path : `word/${path}`;
      const entry = archive.getEntry(mediaPath);
      if (!entry) return unsupported("DOCX 图片对象缺失");
      if (assets.length >= 100) throw new FormattingError("TOO_MANY_IMAGES", "原稿最多支持 100 张图片。");
      const asset = await normalizeImage(entry.getData(), assets.length); assets.push(asset);
      const description = all(drawing, "docPr")[0];
      blocks.push({ kind: "figure", id: id("figure", blocks.length), assetId: asset.placeholderId, caption: description ? attr(description, "descr") : "", alignment: "center", placement: "here" });
    }
  }
  return { blocks, assets };
}

export async function parseFormattingSource(input: { filename: string; buffer: Buffer; metadata: FormattingMetadata; signal: AbortSignal }): Promise<PaperImportResult> {
  if (!input.buffer.length || input.buffer.length > MAX_FORMATTING_SOURCE_BYTES) throw new FormattingError("SOURCE_SIZE", "原稿不能为空且不能超过 20 MB。");
  const sourceType = formattingSourceType(input.filename);
  const parsed = sourceType === "docx" ? await docxImport(input.buffer) : await markdownImport(input.buffer, input.signal);
  if (!parsed.blocks.length) throw new FormattingError("SOURCE_EMPTY", "原稿没有可排版正文。");
  if (parsed.assets.reduce((sum, a) => sum + a.buffer.length, 0) > MAX_EXPANDED_BYTES) throw new FormattingError("ASSETS_TOO_LARGE", "图片总大小超过处理限制。");
  const blocks: DocumentBlock[] = [{ kind: "paper_metadata", ...input.metadata }, ...parsed.blocks];
  const document = parseAcademicDocument({ schemaVersion: "1", title: input.metadata.title, blocks });
  return { document, assets: parsed.assets, references: [], report: {
    parserVersion: "paper-formatting-import-v1", sourceType, warnings: [],
    lowConfidenceBlocks: document.blocks.flatMap((block, index) => block.kind === "figure" && !block.caption ? [{ index, reason: "此图片没有图注，请确认仍按正文图片保留" }] : []),
    blockCount: document.blocks.length,
  } };
}

export function formattingSourceHash(buffer: Buffer): string { return createHash("sha256").update(buffer).digest("hex"); }
