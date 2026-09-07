// @vitest-environment node
import { describe, expect, it } from "vitest";
import AdmZip from "adm-zip";
import {
  DocumentExtractionError,
  resolveChatDocumentAttachments,
} from "./document-extract";
import type { ServerFileAttachment } from "@/lib/chat/router";

async function buildTextPdf(pages: string[]): Promise<Buffer> {
  const { default: PDFDocument } = await import("pdfkit");
  const doc = new PDFDocument({ size: "A4", margin: 40 });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });
  pages.forEach((page, index) => {
    if (index > 0) doc.addPage();
    doc.fontSize(14).text(page);
  });
  doc.end();
  return done;
}

function buildDocx(paragraphs: string[]): Buffer {
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${paragraphs
      .map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`)
      .join("")}</w:body></w:document>`;
  const zip = new AdmZip();
  zip.addFile("word/document.xml", Buffer.from(xml, "utf8"));
  return zip.toBuffer();
}

function attachment(
  name: string,
  mimeType: string,
  data: Buffer
): ServerFileAttachment {
  return { name, mimeType, size: data.length, data };
}

describe("resolveChatDocumentAttachments", () => {
  it("文本型 PDF 被提取为带页码的正文段，不再进入媒体附件", async () => {
    const pdf = await buildTextPdf(["Course syllabus page one", "Grading policy page two"]);
    const result = await resolveChatDocumentAttachments([
      attachment("课程说明.pdf", "application/pdf", pdf),
    ]);
    expect(result.attachments).toHaveLength(0);
    expect(result.textSections).toHaveLength(1);
    expect(result.textSections[0]).toContain("课程说明.pdf");
    expect(result.textSections[0]).toContain("第 1 页");
    expect(result.textSections[0]).toContain("Course syllabus page one");
    expect(result.textSections[0]).toContain("第 2 页");
    expect(result.textSections[0]).toContain("Grading policy page two");
  });

  it("扫描 PDF（无文本层）替换为页面 PNG 图片并附显式说明", async () => {
    const pdf = await buildTextPdf([""]);
    const result = await resolveChatDocumentAttachments([
      attachment("扫描件.pdf", "application/pdf", pdf),
    ]);
    expect(result.textSections[0]).toContain("无文本层");
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0].mimeType).toBe("image/png");
    expect(result.attachments[0].name).toContain("扫描件.pdf#第1页.png");
    expect(result.attachments[0].data.subarray(0, 4)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47])
    );
  });

  it("DOCX 提取段落正文为文本段", async () => {
    const docx = buildDocx(["论文第一章正文", "论文第二章正文"]);
    const result = await resolveChatDocumentAttachments([
      attachment("论文.docx", DOCX_MIME, docx),
    ]);
    expect(result.attachments).toHaveLength(0);
    expect(result.textSections[0]).toContain("论文第一章正文");
    expect(result.textSections[0]).toContain("论文第二章正文");
  });

  it(".doc 附件明确要求另存为 .docx", async () => {
    await expect(
      resolveChatDocumentAttachments([
        attachment("旧文档.doc", "application/msword", Buffer.from("%DOC")),
      ])
    ).rejects.toThrow(DocumentExtractionError);
    await expect(
      resolveChatDocumentAttachments([
        attachment("旧文档.doc", "application/msword", Buffer.from("%DOC")),
      ])
    ).rejects.toThrow("另存为 .docx");
  });

  it("图片与文本附件原样保留，不经过文档提取", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const result = await resolveChatDocumentAttachments([
      attachment("截图.png", "image/png", png),
      attachment("笔记.txt", "text/plain", Buffer.from("hello")),
    ]);
    expect(result.textSections).toHaveLength(0);
    expect(result.attachments).toHaveLength(2);
    expect(result.attachments.map((item) => item.name)).toEqual([
      "截图.png",
      "笔记.txt",
    ]);
  });

  it("损坏的 DOCX 以明确错误拒绝，不静默退化为空正文", async () => {
    await expect(
      resolveChatDocumentAttachments([
        attachment("坏文件.docx", DOCX_MIME, Buffer.from("not a zip")),
      ])
    ).rejects.toThrow(DocumentExtractionError);
  });
});

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
