// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  PDF_HEADER_SCAN_WINDOW,
  PDF_INVALID_REASON,
  isPdfLike,
  repairPdfBuffer,
} from "./pdf-integrity";

const VALID_PDF = Buffer.concat([
  Buffer.from("%PDF-1.7\n"),
  Buffer.from("1 0 obj\n<< /Type /Catalog >>\nendobj\n"),
  Buffer.from("startxref\n0\n%%EOF\n"),
]);

describe("repairPdfBuffer", () => {
  it("passes a clean PDF through unchanged without copying", () => {
    const result = repairPdfBuffer(VALID_PDF);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.repaired).toBe(false);
    expect(result.data).toBe(VALID_PDF);
  });

  it("strips leading junk bytes before the %PDF- header (BOM / wrapper)", () => {
    const withBom = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from("junk-from-download-wrapper"),
      VALID_PDF,
    ]);
    const result = repairPdfBuffer(withBom);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.repaired).toBe(true);
    expect(result.data.equals(VALID_PDF)).toBe(true);
  });

  it("trims trailing junk after the final %%EOF", () => {
    const withTrailingJunk = Buffer.concat([
      VALID_PDF,
      Buffer.from("<html>download page</html>"),
    ]);
    const result = repairPdfBuffer(withTrailingJunk);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.repaired).toBe(true);
    expect(result.data.equals(VALID_PDF)).toBe(true);
  });

  it("keeps trailing newlines after %%EOF", () => {
    const withNewline = Buffer.concat([VALID_PDF, Buffer.from("\r\n")]);
    const result = repairPdfBuffer(withNewline);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.equals(withNewline)).toBe(true);
  });

  it("repairs a PDF with both leading and trailing junk in one pass", () => {
    const messy = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      VALID_PDF,
      Buffer.from("garbage"),
    ]);
    const result = repairPdfBuffer(messy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.equals(VALID_PDF)).toBe(true);
  });

  it("keeps a PDF that lacks %%EOF (header-only repair)", () => {
    const noEof = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n");
    const result = repairPdfBuffer(noEof);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.repaired).toBe(false);
    expect(result.data.equals(noEof)).toBe(true);
  });

  it("rejects an empty buffer", () => {
    const result = repairPdfBuffer(Buffer.alloc(0));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("文件为空");
  });

  it("rejects data without a %PDF- header", () => {
    const result = repairPdfBuffer(
      Buffer.from("<html>this is not a pdf</html>")
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe(PDF_INVALID_REASON);
  });

  it("rejects a %PDF- header beyond the spec scan window", () => {
    const junk = Buffer.alloc(PDF_HEADER_SCAN_WINDOW + 1, 0x61);
    const result = repairPdfBuffer(Buffer.concat([junk, VALID_PDF]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe(PDF_INVALID_REASON);
  });

  it("accepts a header exactly at the scan window boundary", () => {
    const junk = Buffer.alloc(PDF_HEADER_SCAN_WINDOW, 0x61);
    const result = repairPdfBuffer(Buffer.concat([junk, VALID_PDF]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.equals(VALID_PDF)).toBe(true);
  });
});

describe("isPdfLike", () => {
  it("matches by mime type or filename", () => {
    expect(isPdfLike("application/pdf", "notes")).toBe(true);
    expect(isPdfLike("application/octet-stream", "lecture.PDF")).toBe(true);
    expect(isPdfLike("", "lecture.pdf")).toBe(true);
    expect(isPdfLike("application/octet-stream", "notes.docx")).toBe(false);
  });
});
