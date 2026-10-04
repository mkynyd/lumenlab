import "server-only";
import sharp from "sharp";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute = promisify(execFile);
const OFFICE_EXTENSIONS = new Set(["doc", "docx", "ppt", "pptx", "odt", "odp"]);

/** Complete originals never enter project/chat storage or durable model history. */
export async function renderStudyDocument(buffer: Buffer, name: string, mimeType: string): Promise<Buffer[]> {
  if (buffer.length > 30 * 1024 * 1024 || !buffer.length) throw new Error("单个文档需在30MB以内");
  const ext = path.extname(name).slice(1).toLowerCase();
  if (mimeType.startsWith("image/")) {
    return [await sharp(buffer, { limitInputPixels: 40000000 }).rotate().resize({ width: 2200, height: 3000, fit: "inside", withoutEnlargement: true }).png().toBuffer()];
  }
  let pdf = buffer;
  if (OFFICE_EXTENSIONS.has(ext)) {
    const directory = await mkdtemp(path.join(tmpdir(), "lumenlab-study-"));
    try {
      const inputPath = path.join(directory, `source.${ext}`);
      await writeFile(inputPath, buffer, { mode: 0o600 });
      await execute(process.env.STUDY_OFFICE_BINARY || "soffice", [
        `-env:UserInstallation=${pathToFileURL(path.join(directory, "profile")).href}`,
        "--headless", "--nologo", "--nodefault", "--nofirststartwizard", "--convert-to", "pdf", "--outdir", directory, inputPath,
      ], { timeout: 60000, maxBuffer: 1024 * 1024 });
      pdf = await readFile(path.join(directory, "source.pdf"));
    } catch {
      throw new Error("Office文档转换失败，请检查LibreOffice服务或将文档另存为PDF");
    } finally { await rm(directory, { recursive: true, force: true }); }
  } else if (ext !== "pdf" && mimeType !== "application/pdf") {
    throw new Error("当前扫描导入支持图片、PDF、Word与PPT");
  }
  const [{ createCanvas }, pdfjs] = await Promise.all([import("@napi-rs/canvas"), import("pdfjs-dist/legacy/build/pdf.mjs")]);
  const document = await pdfjs.getDocument({
    data: new Uint8Array(pdf),
    useSystemFonts: true,
    disableFontFace: true,
    cMapUrl: path.join(process.cwd(), "public/pdfjs/cmaps") + path.sep,
    standardFontDataUrl: path.join(process.cwd(), "public/pdfjs/standard_fonts") + path.sep,
    wasmUrl: path.join(process.cwd(), "node_modules/pdfjs-dist/wasm") + path.sep,
  }).promise;
  try {
    if (document.numPages > 80) throw new Error("一次最多导入80页，请分批上传；未截断文档");
    const pages: Buffer[] = [];
    let total = 0;
    for (let index = 1; index <= document.numPages; index++) {
      const page = await document.getPage(index);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(2.5, 2200 / Math.max(base.width, base.height)) });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: canvas.getContext("2d") as unknown as CanvasRenderingContext2D, viewport }).promise;
      const png = canvas.toBuffer("image/png");
      total += png.length;
      if (total > 150 * 1024 * 1024) throw new Error("预览图像总量过大，请分批上传；未截断文档");
      pages.push(png);
      page.cleanup();
    }
    return pages;
  } finally { await document.destroy(); }
}
