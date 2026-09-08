/**
 * Chat 附件的文档输入适配（任务 03.7 推荐替代链路）。
 *
 * Responses 合同没有 PDF/Word document content part，因此在进入 runtime
 * 路由与模型适配器之前，把文本型 PDF/DOCX 附件在本地提取为带页码的正文
 * （与文本附件一样内联进提示词），把扫描 PDF 渲染为页面图片交给最终所选
 * 多模态模型。这里不做任何独立视觉模型调用；渲染失败给出明确错误，不静默
 * 退化成文件名占位符。
 */
import type { ServerFileAttachment } from "@/lib/chat/router";
import { isTextAttachment } from "@/lib/chat/router";

export class DocumentExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentExtractionError";
  }
}

const PDF_MIME = "application/pdf";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** 单个文档内联正文上限（字符）。超出时保留开头并显式标注截断，不静默丢弃。 */
const MAX_INLINE_TEXT_CHARS = 60_000;
/** 平均每页低于该字符数视为无文本层（扫描件）。 */
const SCANNED_PAGE_CHARS = 4;
/** 扫描 PDF 渲染页数上限；超出部分在正文中显式说明，不静默截断。 */
const MAX_RENDER_PAGES = 8;
/** 渲染页面的最长边（像素）。 */
const RENDER_MAX_EDGE = 1600;

function extensionOf(name: string): string {
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index + 1).toLowerCase() : "";
}

function mimeOf(attachment: ServerFileAttachment): string {
  return attachment.mimeType || "";
}

export function isPdfAttachment(attachment: ServerFileAttachment): boolean {
  return (
    mimeOf(attachment) === PDF_MIME ||
    (mimeOf(attachment).length === 0 && extensionOf(attachment.name) === "pdf")
  );
}

export function isDocxAttachment(attachment: ServerFileAttachment): boolean {
  const mime = mimeOf(attachment);
  if (mime === DOCX_MIME) return true;
  return mime.length === 0 && extensionOf(attachment.name) === "docx";
}

/** 上传白名单内的其余文档格式（.doc/.xls/.ppt 等）当前没有可用的本地提取链路。 */
function rejectUnsupported(attachment: ServerFileAttachment): never {
  const ext = extensionOf(attachment.name);
  if (ext === "doc") {
    throw new DocumentExtractionError(
      `${attachment.name}：暂不支持 .doc，请另存为 .docx 后重新上传`
    );
  }
  throw new DocumentExtractionError(
    `${attachment.name}：暂不支持 ${ext || mimeOf(attachment) || "该格式"} 附件，请转换为 PDF、DOCX 或图片后重试`
  );
}

interface PdfTextResult {
  pages: string[];
}

async function loadPdfjs() {
  // 动态引入：pdfjs 的 legacy 构建在模块加载时有副作用（worker/DOM 探测），
  // 延迟到真正需要解析文档时再加载，避免影响普通聊天与测试环境。
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjs;
}

async function extractPdfPages(data: Buffer): Promise<PdfTextResult> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(data),
    useSystemFonts: false,
    disableFontFace: true,
  }).promise;
  try {
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      pages.push(text);
    }
    return { pages };
  } finally {
    await doc.destroy();
  }
}

async function renderPdfPageImages(
  data: Buffer,
  filename: string
): Promise<ServerFileAttachment[]> {
  const [{ createCanvas }, pdfjs] = await Promise.all([
    import("@napi-rs/canvas"),
    loadPdfjs(),
  ]);
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(data),
    useSystemFonts: false,
    disableFontFace: true,
  }).promise;
  try {
    const rendered: ServerFileAttachment[] = [];
    const pageCount = doc.numPages;
    const limit = Math.min(pageCount, MAX_RENDER_PAGES);
    for (let pageNumber = 1; pageNumber <= limit; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(
        RENDER_MAX_EDGE / Math.max(base.width, base.height),
        2
      );
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(
        Math.ceil(viewport.width),
        Math.ceil(viewport.height)
      );
      const context = canvas.getContext("2d");
      await page.render({
        canvas: canvas as unknown as HTMLCanvasElement,
        // pdfjs 5.x 的 RenderParameters 要求 CanvasRenderingContext2D，
        // @napi-rs/canvas 的 2D 上下文接口兼容。
        canvasContext: context as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise;
      const png = canvas.toBuffer("image/png");
      rendered.push({
        name: `${filename}#第${pageNumber}页.png`,
        mimeType: "image/png",
        size: png.length,
        data: png,
      });
    }
    return rendered;
  } finally {
    await doc.destroy();
  }
}

/** DOCX 本质是 zip：直接读取 word/document.xml 提取段落文本，不引入额外依赖。 */
async function extractDocxText(data: Buffer, filename: string): Promise<string> {
  let text: string;
  try {
    const { default: AdmZip } = await import("adm-zip");
    const zip = new AdmZip(data);
    const entry = zip.getEntry("word/document.xml");
    if (!entry) {
      throw new Error("缺少 word/document.xml");
    }
    const xml = zip.readAsText(entry);
    text = xml
      .replace(/<w:tab[^>]*\/>/g, "\t")
      .replace(/<w:br[^>]*\/>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  } catch (error) {
    throw new DocumentExtractionError(
      `${filename}：无法读取 DOCX 内容${
        error instanceof Error && error.message ? `（${error.message}）` : ""
      }`
    );
  }
  if (!text) {
    throw new DocumentExtractionError(`${filename}：DOCX 中没有可提取的正文`);
  }
  return text;
}

function truncateWithNotice(text: string, filename: string): string {
  if (text.length <= MAX_INLINE_TEXT_CHARS) return text;
  return (
    `${text.slice(0, MAX_INLINE_TEXT_CHARS)}\n\n` +
    `[注意] ${filename} 正文超过 ${MAX_INLINE_TEXT_CHARS} 字符上限，仅保留开头部分；` +
    `如需其余内容请让用户拆分文件后重传。`
  );
}

export interface ResolvedDocumentAttachments {
  /** 提取出的文档正文段（带页码/截断标注），由调用方内联进提示词。 */
  textSections: string[];
  /**
   * 转换后的媒体附件列表：文本型 PDF/DOCX 被移除（正文已内联），扫描 PDF
   * 替换为页面 PNG；图片、视频、音频与文本附件原样保留。
   */
  attachments: ServerFileAttachment[];
}

/**
 * 把聊天附件中的 PDF/DOCX 转换为最终模型可消费的输入。按任务 03 的边界，
 * 这里只做本地文本提取与页面渲染，不调用任何独立视觉/OCR 模型。
 */
export async function resolveChatDocumentAttachments(
  attachments: ServerFileAttachment[]
): Promise<ResolvedDocumentAttachments> {
  const textSections: string[] = [];
  const media: ServerFileAttachment[] = [];
  for (const attachment of attachments) {
    if (isTextAttachment(attachment)) {
      media.push(attachment);
      continue;
    }
    if (
      attachment.mimeType.startsWith("image/") ||
      attachment.mimeType.startsWith("video/") ||
      attachment.mimeType.startsWith("audio/")
    ) {
      // 媒体附件不属于文档提取范围：图片是各活跃模型的原生输入，
      // 视频/音频由序列化层按模型能力决定接受或拒绝。
      media.push(attachment);
      continue;
    }
    if (isPdfAttachment(attachment)) {
      const { pages } = await extractPdfPages(attachment.data);
      const meaningful = pages.filter((page) => page.length > 0);
      const averageChars =
        pages.length > 0
          ? meaningful.reduce((sum, page) => sum + page.length, 0) / pages.length
          : 0;
      if (averageChars >= SCANNED_PAGE_CHARS) {
        const numbered = pages
          .map((page, index) =>
            page ? `（第 ${index + 1} 页）${page}` : `（第 ${index + 1} 页，无文本层）`
          )
          .join("\n\n");
        textSections.push(
          `---\n文件：${attachment.name}（PDF，共 ${pages.length} 页）\n\n${truncateWithNotice(numbered, attachment.name)}`
        );
        continue;
      }
      // 无文本层（扫描件）：渲染页面图片交给最终多模态模型，并显式说明覆盖范围。
      const images = await renderPdfPageImages(attachment.data, attachment.name);
      const renderedPages = Math.min(pages.length, MAX_RENDER_PAGES);
      const notice =
        pages.length > renderedPages
          ? `该扫描 PDF 共 ${pages.length} 页，受单次渲染上限只提交前 ${renderedPages} 页页面图片，其余内容未包含。`
          : `该扫描 PDF 无文本层，已按页提交 ${renderedPages} 张页面图片。`;
      textSections.push(
        `---\n文件：${attachment.name}（扫描 PDF，共 ${pages.length} 页）\n\n${notice}`
      );
      media.push(...images);
      continue;
    }
    if (isDocxAttachment(attachment)) {
      const text = await extractDocxText(attachment.data, attachment.name);
      textSections.push(
        `---\n文件：${attachment.name}（DOCX）\n\n${truncateWithNotice(text, attachment.name)}`
      );
      continue;
    }
    rejectUnsupported(attachment);
  }
  return { textSections, attachments: media };
}
