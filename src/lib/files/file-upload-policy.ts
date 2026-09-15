/**
 * 文件上传共享策略
 *
 * 项目文件上传与聊天附件共享同一套扩展名白名单与大小限制，
 * 避免两处校验不一致导致的安全缺口。
 *
 * 纯数据与字符串校验在 allowed-extensions.ts（客户端安全）；本模块保留
 * 依赖 node:path 与 Buffer 的服务端校验，并 re-export 共享部分以兼容既有引用。
 */

import {
  CODE_EXTENSIONS,
  DOCUMENT_EXTENSIONS,
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS,
  extensionOf,
} from "./allowed-extensions";

export {
  ALLOWED_EXTENSIONS,
  MAX_FILE_SIZE,
  MAX_FILES_PER_REQUEST,
  MAX_TOTAL_SIZE,
  ACCEPT_ATTRIBUTE,
  extensionOf,
  getMimeTypeForExtension,
  isAllowedExtension,
  validateUploadBatch,
  validateUploadFile,
  type BatchValidationResult,
  type UploadFileLike,
} from "./allowed-extensions";

export {
  CODE_EXTENSIONS,
  DOCUMENT_EXTENSIONS,
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS,
};

/** Detect the supported raster formats from their wire signatures. */
export function detectImageMimeType(data: Buffer): string | null {
  if (
    data.length >= 8 &&
    data.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    )
  ) {
    return "image/png";
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    data.length >= 12 &&
    data.subarray(0, 4).toString("ascii") === "RIFF" &&
    data.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export function validateImageFileBytes(
  filename: string,
  data: Buffer
): { ok: true; mimeType: string } | { ok: false; error: string } {
  const expected = IMAGE_EXTENSIONS[extensionOf(filename)];
  if (!expected) return { ok: false, error: "不是受支持的图片扩展名" };
  const detected = detectImageMimeType(data);
  if (!detected) return { ok: false, error: "图片文件头无效或格式不受支持" };
  if (detected !== expected) {
    return {
      ok: false,
      error: `图片内容格式为 ${detected}，与扩展名要求的 ${expected} 不一致`,
    };
  }
  return { ok: true, mimeType: detected };
}
