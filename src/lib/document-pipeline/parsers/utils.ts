/**
 * MiniMax 文档解析端点单请求上限约 32MB；20MB PDF base64 后约 27MB，
 * 留足请求头余量。超过此阈值的 PDF 分流到 MinerU。
 */
export const MAX_MINIMAX_PDF_BYTES = 20 * 1024 * 1024;

/** MinerU 托管 API 单文件上限（200MB / 200 页） */
export const MAX_MINERU_FILE_BYTES = 200 * 1024 * 1024;

export function extensionOf(filename: string): string {
  const index = filename.lastIndexOf(".");
  return index >= 0 ? filename.slice(index + 1).toLowerCase() : "";
}
