import { spawn } from "node:child_process";
import { chromium } from "playwright-core";
import { chromiumExecutablePath } from "./browser-pdf";
import { markdownToDocx } from "./markdown-to-docx";
import { getPdfFont } from "./markdown-to-pdf";
import { markdownToSlides, markdownToWorkbook } from "./markdown-to-office";
import { validatePdfExport } from "./pdf-validation";
import type { ArtifactDownloadFormat } from "@/lib/artifacts/download";

const PRINT_STYLE = `
  @page { size: A4; margin: 16mm 17mm 17mm; }
  body { font: 10.5pt/1.7 "Document Sans", "Noto Sans CJK SC", sans-serif; color: #17233b; margin: 0; overflow-wrap: anywhere; }
  h1 { font-size: 22pt; line-height: 1.3; margin: 0 0 1rem; }
  h2 { font-size: 15pt; margin: 1.3rem 0 .4rem; }
  h3,h4 { font-size: 12pt; margin: 1rem 0 .3rem; }
  h1,h2,h3,h4 { break-after: avoid; }
  p,li { orphans: 2; widows: 2; }
  p { margin: 0 0 .65em; }
  ul,ol { margin: .35em 0 .75em; padding-inline-start: 1.6em; }
  table { border-collapse: collapse; width: 100%; margin: .75em 0 1em; font-size: 9.5pt; }
  th,td { border: 1px solid #b7c3d0; padding: .35em .55em; text-align: start; vertical-align: top; }
  thead { display: table-header-group; background: #edf2f8; }
  tr { break-inside: avoid; }
  pre { white-space: pre-wrap; padding: .7em 1em; background: #eef2f6; }
  code { font-family: ui-monospace, monospace; }
  blockquote { margin-inline: 0; padding-inline-start: 1em; box-shadow: inset 2px 0 #9eafc4; }
  a { color: #174d84; text-decoration: underline; }
  math[display="block"] { margin-block: .65em; }
  img { max-width: 100%; }
`;

async function markdownToPrintHtml(content: string, signal?: AbortSignal) {
  return new Promise<string>((resolve, reject) => {
    const process = spawn("pandoc", [
      "--from=markdown-raw_html-raw_tex", "--to=html5", "--mathml", "--no-highlight",
    ], { signal: AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]) });
    const stdout: Buffer[] = [];
    process.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    process.stderr.resume();
    process.on("error", reject);
    process.stdin.on("error", reject);
    process.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(stdout).toString("utf8"));
      else reject(new Error("PDF 正文转换失败"));
    });
    process.stdin.end(content, "utf8");
  });
}

async function renderDocumentPdf(content: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const html = await markdownToPrintHtml(content, signal);
  const browser = await chromium.launch({
    executablePath: chromiumExecutablePath(), headless: true, timeout: 20_000,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const stop = () => { void browser.close().catch(() => {}); };
  signal?.addEventListener("abort", stop, { once: true });
  try {
    signal?.throwIfAborted();
    const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: "block" });
    await context.route("**/*", (route) => route.abort("blockedbyclient"));
    const page = await context.newPage();
    const font = getPdfFont().toString("base64");
    await page.setContent(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:;"><style>@font-face{font-family:"Document Sans";src:url(data:font/woff2;base64,${font}) format("woff2")}${PRINT_STYLE}</style></head><body>${html}</body></html>`,
      { waitUntil: "load", timeout: 20_000 });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const file = Buffer.from(await page.pdf({ preferCSSPageSize: true, printBackground: true }));
    await validatePdfExport(file);
    return file;
  } finally {
    signal?.removeEventListener("abort", stop);
    await browser.close();
  }
}

export async function renderArtifactFile(
  content: string, title: string, format: ArtifactDownloadFormat, signal?: AbortSignal,
): Promise<Buffer> {
  signal?.throwIfAborted();
  if (!content.trim()) throw new Error("文件没有正文");
  switch (format) {
    case "markdown": return Buffer.from(content, "utf8");
    case "docx": return markdownToDocx(content, { editableTables: true });
    case "pdf": return renderDocumentPdf(content, signal);
    case "xlsx": return markdownToWorkbook(content);
    case "pptx": return markdownToSlides(content, title);
  }
}
