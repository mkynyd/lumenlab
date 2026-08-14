/**
 * PDF 完整性校验与修复
 *
 * MiniMax 的 document block 对 PDF 字节布局很严格：文件头 %PDF- 不在文件
 * 起始处（例如前面有 UTF-8 BOM、下载包装器写入的杂质字节）时，后端会以
 * "missing %PDF- header" 拒绝整个请求。这里在字节进入模型请求前统一做一次：
 *
 *   1. 校验：文件头 %PDF- 必须出现在前 1024 字节（PDF 1.x 规范要求），
 *      否则判定为损坏或非 PDF，直接给出可操作的错误提示；
 *   2. 修复：裁掉 %PDF- 之前的杂质字节、裁掉最后一个 %%EOF 之后的尾部杂质，
 *      把字节对齐到标准 PDF 布局后再发送。
 *
 * 该模块不依赖任何第三方解析库，只做字节级修复，成本是两次线性扫描。
 */

export const PDF_HEADER_SCAN_WINDOW = 1024;
const PDF_HEADER = Buffer.from("%PDF-", "ascii");
const PDF_EOF = Buffer.from("%%EOF", "ascii");

export type PdfRepairResult<T extends ArrayBufferLike = ArrayBufferLike> =
  | { ok: true; data: Buffer<T>; repaired: boolean }
  | { ok: false; reason: string };

export const PDF_INVALID_REASON =
  "不是有效的 PDF 文件（缺少 %PDF- 文件头）。文件可能已损坏、下载不完整，或后缀被改写过；请重新下载或导出 PDF 后再上传";

export function repairPdfBuffer<T extends ArrayBufferLike>(
  data: Buffer<T>
): PdfRepairResult<T> {
  if (!Buffer.isBuffer(data) || data.length === 0) {
    return { ok: false, reason: "文件为空，无法作为 PDF 解析" };
  }

  const headerOffset = data.indexOf(PDF_HEADER);
  if (headerOffset < 0 || headerOffset > PDF_HEADER_SCAN_WINDOW) {
    return { ok: false, reason: PDF_INVALID_REASON };
  }

  // 使用 subarray 视图而不是拷贝：修复只改变字节视图范围，且调用方只读。
  let cleaned: Buffer<T> =
    headerOffset === 0 ? data : data.subarray(headerOffset);
  let repaired = headerOffset > 0;

  // %%EOF 按规范应出现在文件尾部（最后 1024 字节内）；找到则裁掉其后的
  // 杂质字节（保留尾部换行），缺失时不做尾部裁剪——许多解析器可以容忍。
  const eofOffset = cleaned.lastIndexOf(PDF_EOF);
  if (
    eofOffset >= 0 &&
    cleaned.length - (eofOffset + PDF_EOF.length) <= PDF_HEADER_SCAN_WINDOW
  ) {
    let end = eofOffset + PDF_EOF.length;
    while (
      end < cleaned.length &&
      (cleaned[end] === 0x0d || cleaned[end] === 0x0a || cleaned[end] === 0x20)
    ) {
      end += 1;
    }
    if (end < cleaned.length) {
      cleaned = cleaned.subarray(0, end);
      repaired = true;
    }
  }

  return { ok: true, data: cleaned, repaired };
}

export function isPdfLike(mimeType: string, filename: string): boolean {
  return (
    mimeType === "application/pdf" ||
    filename.toLowerCase().endsWith(".pdf")
  );
}
