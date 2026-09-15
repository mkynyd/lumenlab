/**
 * 按文件名扩展名/MIME 选择文件类型图标，供聊天附件卡片与 Composer 预览条共用。
 * 纯客户端安全（只依赖 lucide-react）。
 */
import {
  File,
  FileArchive,
  FileAudio,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Presentation,
  type LucideIcon,
} from "lucide-react";

import { extensionOf } from "./allowed-extensions";

const ARCHIVE_EXTENSIONS = new Set([
  "zip",
  "rar",
  "7z",
  "tar",
  "gz",
  "bz2",
  "xz",
]);

const CODE_ICON_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "csv",
  "json",
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "py",
  "c",
  "cpp",
  "h",
  "hpp",
  "java",
  "sql",
  "html",
  "css",
  "xml",
  "yaml",
  "yml",
  "toml",
  "ini",
  "sh",
  "zsh",
  "bash",
  "go",
  "rs",
  "swift",
  "kt",
  "rb",
  "php",
]);

export function attachmentIconFor(
  name: string,
  mimeType: string
): LucideIcon {
  if (mimeType.startsWith("image/")) return FileImage;
  if (mimeType.startsWith("video/")) return FileVideo;
  if (mimeType.startsWith("audio/")) return FileAudio;

  const ext = extensionOf(name);
  if (ext === "pdf") return FileText;
  if (ARCHIVE_EXTENSIONS.has(ext)) return FileArchive;
  if (
    ext === "xls" ||
    ext === "xlsx" ||
    ext === "csv" ||
    ext === "et" ||
    ext === "numbers"
  ) {
    return FileSpreadsheet;
  }
  if (
    ext === "ppt" ||
    ext === "pptx" ||
    ext === "dps" ||
    ext === "key"
  ) {
    return Presentation;
  }
  if (CODE_ICON_EXTENSIONS.has(ext)) return FileCode2;
  if (
    ext === "doc" ||
    ext === "docx" ||
    ext === "wps" ||
    ext === "pages"
  ) {
    return FileText;
  }
  return File;
}
