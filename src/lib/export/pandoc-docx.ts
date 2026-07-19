import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import AdmZip from "adm-zip";
import sharp from "sharp";

import type { ResolveImage } from "@/lib/export/markdown-to-docx";
import { renderMermaidPng } from "@/lib/export/mermaid-image";
import { parseLumenFlow, renderLumenFlowSvg } from "@/lib/lumenflow";

const PANDOC_TIMEOUT_MS = 60_000;
const IMAGE_PATTERN = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
const IMAGE_CONTENT_TYPES: Record<string, string> = {
  bmp: "image/bmp",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  tif: "image/tiff",
  tiff: "image/tiff",
};

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function plainHtmlText(value: string) {
  return decodeHtml(value.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim()
    .replaceAll("|", "\\|");
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/** Convert common copied HTML tables into GFM before Pandoc sees raw HTML. */
export function normalizeHtmlTablesForPandoc(content: string): string {
  return content.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (_table, body) => {
    const rows = [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
      .map((match) =>
        [...match[1].matchAll(/<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((cell) =>
          plainHtmlText(cell[2])
        )
      )
      .filter((row) => row.length > 0);
    if (rows.length === 0) return "";

    const columnCount = Math.max(...rows.map((row) => row.length));
    const normalizedRows = rows.map((row) =>
      Array.from({ length: columnCount }, (_, index) => row[index] || "")
    );
    const [header, ...data] = normalizedRows;
    return [
      `| ${header.join(" | ")} |`,
      `| ${header.map(() => "---").join(" | ")} |`,
      ...data.map((row) => `| ${row.join(" | ")} |`),
    ].join("\n");
  });
}

function normalizedResourcePath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function isSafeResourcePath(value: string) {
  const normalized = normalizedResourcePath(value);
  return (
    (normalized.startsWith("pics/") ||
      normalized.startsWith("diagrams/") ||
      normalized.startsWith("tables/")) &&
    path.posix.normalize(normalized) === normalized &&
    !normalized.split("/").some((segment) => !segment || segment === "..")
  );
}

function materializeLumenFlowDiagrams(content: string, workdir: string) {
  let diagramIndex = 0;
  const writes: Promise<void>[] = [];
  const normalized = content.replace(/```lumenflow[ \t]*\n([\s\S]*?)```/g, (_block, source: string) => {
    const parsed = parseLumenFlow(source);
    if (!parsed.ok) {
      return `> LumenFlow 图表无法渲染：${parsed.error}\n\n\`\`\`text\n${source.trim()}\n\`\`\``;
    }
    diagramIndex += 1;
    const relativePath = `diagrams/lumenflow-${diagramIndex}.png`;
    writes.push(
      sharp(Buffer.from(renderLumenFlowSvg(parsed.diagram)))
        .png()
        .toBuffer()
        .then(async (buffer) => {
          const destination = path.join(workdir, relativePath);
          await mkdir(path.dirname(destination), { recursive: true });
          await writeFile(destination, buffer);
        })
    );
    return `![${parsed.diagram.title || "LumenFlow 流程图"}](${relativePath})`;
  });
  return { normalized, writes };
}

function tableCells(line: string) {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replaceAll("\\|", "|").trim());
}

function displayWidth(value: string) {
  return [...value].reduce((width, character) => width + (character.charCodeAt(0) > 127 ? 2 : 1), 0);
}

function renderTableSvg(rows: string[][]): string {
  const columnCount = Math.max(...rows.map((row) => row.length));
  const normalizedRows = rows.map((row) =>
    Array.from({ length: columnCount }, (_, index) => row[index] || "")
  );
  const idealWidths = Array.from({ length: columnCount }, (_, index) =>
    Math.max(132, ...normalizedRows.map((row) => Math.min(360, displayWidth(row[index]) * 9 + 40)))
  );
  const idealTotal = idealWidths.reduce((total, width) => total + width, 0);
  const scale = Math.min(1, 920 / idealTotal);
  const widths = idealWidths.map((width) => Math.max(112, Math.floor(width * scale)));
  const width = widths.reduce((total, columnWidth) => total + columnWidth, 0);
  const rowHeight = 48;
  const height = normalizedRows.length * rowHeight;
  const xOffsets = widths.reduce<number[]>((offsets, columnWidth) => {
    offsets.push((offsets.at(-1) || 0) + columnWidth);
    return offsets;
  }, []);
  const cells = normalizedRows
    .flatMap((row, rowIndex) =>
      row.map((cell, columnIndex) => {
        const x = columnIndex === 0 ? 0 : xOffsets[columnIndex - 1];
        const fill = rowIndex === 0 ? "#eef4ff" : "#ffffff";
        return `<rect x="${x}" y="${rowIndex * rowHeight}" width="${widths[columnIndex]}" height="${rowHeight}" fill="${fill}" stroke="#d1d5db"/><text x="${x + 18}" y="${rowIndex * rowHeight + 31}" fill="#1f2937" font-family="Arial, 'Noto Sans SC', sans-serif" font-size="16" font-weight="${rowIndex === 0 ? 700 : 400}">${escapeXml(cell)}</text>`;
      })
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="表格">${cells}</svg>`;
}

function materializeMarkdownTables(content: string, workdir: string) {
  const lines = content.split("\n");
  const output: string[] = [];
  const writes: Promise<void>[] = [];
  let tableIndex = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const header = lines[index];
    const separator = lines[index + 1];
    const isTable =
      header?.trim().startsWith("|") &&
      separator?.trim().startsWith("|") &&
      /^\|\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(separator.trim());
    if (!isTable) {
      output.push(header);
      continue;
    }

    const rows = [tableCells(header)];
    index += 2;
    while (index < lines.length && lines[index].trim().startsWith("|")) {
      rows.push(tableCells(lines[index]));
      index += 1;
    }
    index -= 1;
    tableIndex += 1;
    const relativePath = `tables/table-${tableIndex}.png`;
    writes.push(
      sharp(Buffer.from(renderTableSvg(rows)))
        .png()
        .toBuffer()
        .then(async (buffer) => {
          const destination = path.join(workdir, relativePath);
          await mkdir(path.dirname(destination), { recursive: true });
          await writeFile(destination, buffer);
        })
    );
    output.push(`![表格](${relativePath})`);
  }
  return { normalized: output.join("\n"), writes };
}

async function materializeImages(
  content: string,
  workdir: string,
  resolveImage?: ResolveImage
) {
  const matches = [...content.matchAll(IMAGE_PATTERN)];
  if (matches.length === 0) return content;

  let cursor = 0;
  let output = "";
  for (const match of matches) {
    const [full, alt, source] = match;
    const index = match.index ?? 0;
    output += content.slice(cursor, index);
    cursor = index + full.length;
    const relativePath = normalizedResourcePath(source);
    if (!isSafeResourcePath(source)) {
      output += `*[未嵌入图片：${alt || source}]*`;
      continue;
    }

    const resolved = await resolveImage?.(relativePath);
    if (!resolved) {
      output += relativePath.startsWith("diagrams/") || relativePath.startsWith("tables/")
        ? full
        : `*[未嵌入图片：${alt || source}]*`;
      continue;
    }

    const destination = path.join(workdir, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, resolved.buffer);
    output += `![${alt}](${relativePath})`;
  }
  return output + content.slice(cursor);
}

async function materializeMermaidDiagrams(content: string, workdir: string) {
  const matches = [...content.matchAll(/```mermaid[ \t]*\n([\s\S]*?)```/g)];
  if (matches.length === 0) return content;

  let cursor = 0;
  let output = "";
  for (const [index, match] of matches.entries()) {
    const source = match[1].trim();
    const relativePath = `diagrams/mermaid-${index + 1}.png`;
    try {
      const buffer = await renderMermaidPng(source);
      const destination = path.join(workdir, relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, buffer);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Mermaid 图表渲染失败：${detail}`);
    }
    const start = match.index ?? 0;
    output += content.slice(cursor, start);
    output += `![Mermaid 图表](${relativePath})`;
    cursor = start + match[0].length;
  }
  return output + content.slice(cursor);
}

/**
 * Pandoc 3.9 can embed media without copying its Default content-type entry
 * from a reference document. Word opens those files, but strict validators
 * flag them. Repair the OpenXML package before it is cached or returned.
 */
export function ensureDocxImageContentTypes(buffer: Buffer): Buffer {
  const archive = new AdmZip(buffer);
  const contentTypes = archive.getEntry("[Content_Types].xml");
  if (!contentTypes) throw new Error("DOCX 缺少 [Content_Types].xml");

  let xml = contentTypes.getData().toString("utf8");
  const mediaExtensions = new Set(
    archive
      .getEntries()
      .map((entry) => entry.entryName)
      .filter((entry) => entry.startsWith("word/media/"))
      .map((entry) => path.extname(entry).slice(1).toLowerCase())
      .filter((extension) => IMAGE_CONTENT_TYPES[extension])
  );
  for (const extension of mediaExtensions) {
    const declaration = new RegExp(
      `<Default\\b[^>]*\\bExtension=["']${extension}["']`,
      "i"
    );
    if (declaration.test(xml)) continue;
    xml = xml.replace(
      "</Types>",
      `<Default Extension="${extension}" ContentType="${IMAGE_CONTENT_TYPES[extension]}"/></Types>`
    );
  }
  archive.updateFile("[Content_Types].xml", Buffer.from(xml, "utf8"));
  return archive.toBuffer();
}

function runPandoc(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("pandoc", args, { cwd, stdio: ["ignore", "ignore", "pipe"] });
    const stderr: Buffer[] = [];
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      fail(new Error("Pandoc DOCX 导出超时"));
    }, PANDOC_TIMEOUT_MS);

    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", (error: NodeJS.ErrnoException) => {
      fail(
        error.code === "ENOENT"
          ? new Error("未安装 Pandoc，无法生成 DOCX。")
          : error
      );
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `Pandoc DOCX 导出失败：${
            Buffer.concat(stderr).toString("utf8").trim() || `exit ${code}`
          }`
        )
      );
    });
  });
}

export async function markdownToPandocDocx(
  content: string,
  options: { resolveImage?: ResolveImage } = {}
): Promise<Buffer> {
  const workdir = await mkdtemp(path.join(tmpdir(), "lumenlab-docx-"));
  try {
    let normalized = normalizeHtmlTablesForPandoc(content);
    const tables = materializeMarkdownTables(normalized, workdir);
    await Promise.all(tables.writes);
    const diagrams = materializeLumenFlowDiagrams(tables.normalized, workdir);
    await Promise.all(diagrams.writes);
    normalized = await materializeMermaidDiagrams(diagrams.normalized, workdir);
    normalized = await materializeImages(normalized, workdir, options.resolveImage);

    const inputPath = path.join(workdir, "document.md");
    const outputPath = path.join(workdir, "document.docx");
    const referenceDocument = path.join(
      process.cwd(),
      "assets",
      "export",
      "reference.docx"
    );
    await writeFile(inputPath, normalized, "utf8");
    await runPandoc(
      [
        inputPath,
        "--from=gfm+raw_html",
        "--to=docx",
        `--output=${outputPath}`,
        `--resource-path=${workdir}`,
        `--reference-doc=${referenceDocument}`,
        "--standalone",
      ],
      workdir
    );
    return ensureDocxImageContentTypes(await readFile(outputPath));
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}
