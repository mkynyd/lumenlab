import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";

export interface PdfValidationResult {
  pageCount: number;
  hasVisibleContent: boolean;
}

const VISIBLE_OPERATOR_IDS = new Set<number>([
  OPS.showText,
  OPS.paintImageXObject,
  OPS.paintImageXObjectRepeat,
  OPS.paintInlineImageXObject,
  OPS.paintXObject,
  OPS.paintSolidColorImageMask,
  OPS.constructPath,
]);

/**
 * Rejects the failure mode where a renderer returns a syntactically valid PDF
 * containing only an empty page. PDFKit and Chromium both produce that shape.
 */
export async function validatePdfExport(buffer: Buffer): Promise<PdfValidationResult> {
  if (buffer.length < 512 || buffer.subarray(0, 5).toString() !== "%PDF-") {
    throw new Error("PDF 导出结果无效");
  }

  const document = await getDocument({ data: new Uint8Array(buffer) }).promise;

  try {
    if (document.numPages < 1) {
      throw new Error("PDF 导出结果没有页面");
    }

    let hasVisibleContent = false;
    for (let index = 1; index <= document.numPages; index += 1) {
      const page = await document.getPage(index);
      const text = await page.getTextContent();
      if (text.items.some((item) => "str" in item && item.str.trim().length > 0)) {
        hasVisibleContent = true;
        break;
      }

      const operators = await page.getOperatorList();
      if (operators.fnArray.some((operator) => VISIBLE_OPERATOR_IDS.has(operator))) {
        hasVisibleContent = true;
        break;
      }
    }

    if (!hasVisibleContent) {
      throw new Error("PDF 导出结果没有可见内容");
    }

    return { pageCount: document.numPages, hasVisibleContent };
  } finally {
    await document.destroy();
  }
}
