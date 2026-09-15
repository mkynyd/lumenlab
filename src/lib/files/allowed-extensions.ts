/**
 * 客户端安全的上传白名单与批量校验。
 *
 * 从 file-upload-policy.ts 拆出：聊天 Composer 需要在浏览器侧做扩展名过滤、
 * 大小/数量预校验与 accept 属性生成，而 file-upload-policy.ts 依赖 node:path
 * 与 Buffer（图片魔数校验），不能直接进客户端包。本模块只含纯数据与字符串逻辑。
 */

export const CODE_EXTENSIONS: Record<string, string> = {
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  ts: "text/typescript",
  tsx: "text/tsx",
  js: "text/javascript",
  jsx: "text/jsx",
  py: "text/x-python",
  c: "text/x-c",
  cpp: "text/x-c++",
  h: "text/x-c",
  java: "text/x-java",
  sql: "text/x-sql",
  html: "text/html",
  css: "text/css",
};

export const DOCUMENT_EXTENSIONS: Record<string, string> = {
  pdf: "application/pdf",
  // Microsoft Office
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  // WPS Office
  wps: "application/wps-office.wps",
  et: "application/wps-office.et",
  dps: "application/wps-office.dps",
  // Apple iWork
  pages: "application/vnd.apple.pages",
  numbers: "application/vnd.apple.numbers",
  key: "application/vnd.apple.keynote",
};

export const IMAGE_EXTENSIONS: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

/** Qwen uses these only for multimodal understanding, never media generation. */
export const VIDEO_EXTENSIONS: Record<string, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

export const ALLOWED_EXTENSIONS = new Set([
  ...Object.keys(CODE_EXTENSIONS),
  ...Object.keys(DOCUMENT_EXTENSIONS),
  ...Object.keys(IMAGE_EXTENSIONS),
  ...Object.keys(VIDEO_EXTENSIONS),
]);

export const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
export const MAX_TOTAL_SIZE = 300 * 1024 * 1024; // 300MB
export const MAX_FILES_PER_REQUEST = 50;

export interface UploadFileLike {
  name: string;
  size: number;
  type?: string;
}

/** 供 <input accept> 使用的过滤串，如 ".png,.jpg,..."。 */
export const ACCEPT_ATTRIBUTE = [...ALLOWED_EXTENSIONS]
  .map((ext) => `.${ext}`)
  .join(",");

export function extensionOf(filename: string): string {
  const base = filename.slice(
    Math.max(filename.lastIndexOf("/"), filename.lastIndexOf("\\")) + 1
  );
  const index = base.lastIndexOf(".");
  return index > 0 ? base.slice(index + 1).toLowerCase() : "";
}

export function getMimeTypeForExtension(ext: string): string | undefined {
  return (
    CODE_EXTENSIONS[ext] ||
    DOCUMENT_EXTENSIONS[ext] ||
    IMAGE_EXTENSIONS[ext] ||
    VIDEO_EXTENSIONS[ext]
  );
}

export function isAllowedExtension(filename: string): boolean {
  return ALLOWED_EXTENSIONS.has(extensionOf(filename));
}

export function validateUploadFile(file: UploadFileLike): string | null {
  if (!file.name) {
    return "文件名无效";
  }
  const ext = extensionOf(file.name);
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return `不支持的文件类型: .${ext || "未知"}`;
  }
  if (file.size > MAX_FILE_SIZE) {
    return `超过 50MB 限制（当前 ${(file.size / 1024 / 1024).toFixed(1)}MB）`;
  }
  return null;
}

export type BatchValidationResult =
  | { ok: true }
  | { ok: false; error: string };

export function validateUploadBatch(
  files: UploadFileLike[]
): BatchValidationResult {
  if (files.length === 0) {
    return { ok: true };
  }
  if (files.length > MAX_FILES_PER_REQUEST) {
    return { ok: false, error: `单次最多上传 ${MAX_FILES_PER_REQUEST} 个文件` };
  }

  const totalSize = files.reduce((sum, file) => sum + (file.size || 0), 0);
  if (totalSize > MAX_TOTAL_SIZE) {
    return {
      ok: false,
      error: `单次上传总大小超过 300MB 限制（当前 ${(totalSize / 1024 / 1024).toFixed(1)}MB）`,
    };
  }

  for (const file of files) {
    const error = validateUploadFile(file);
    if (error) {
      return { ok: false, error: `${file.name || "未知文件"}: ${error}` };
    }
  }

  return { ok: true };
}
