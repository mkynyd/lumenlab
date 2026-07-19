import PDFDocument from "pdfkit";
import { describe, expect, it } from "vitest";

import { validatePdfExport } from "@/lib/export/pdf-validation";

function createPdf(write?: (document: InstanceType<typeof PDFDocument>) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ autoFirstPage: true });
    const chunks: Buffer[] = [];

    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
    write?.(document);
    document.end();
  });
}

describe("validatePdfExport", () => {
  it("accepts a PDF with readable page content", async () => {
    const pdf = await createPdf((document) => document.text("Exported content"));

    await expect(validatePdfExport(pdf)).resolves.toMatchObject({
      pageCount: 1,
      hasVisibleContent: true,
    });
  });

  it("rejects a structurally valid but visually blank PDF", async () => {
    const pdf = await createPdf();

    await expect(validatePdfExport(pdf)).rejects.toThrow("没有可见内容");
  });
});
