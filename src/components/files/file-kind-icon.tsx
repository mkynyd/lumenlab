"use client";

import {
  Code,
  Compress,
  Journal,
  MediaImage,
  MediaVideo,
  MultiplePages,
  Page,
  Table,
} from "iconoir-react";

/**
 * 列表左侧的类型图标。资料页与项目侧栏共用同一套判定与配色，
 * 扫一眼就能分出 PDF / 幻灯片 / 表格 / 代码。
 */
export type FileKind =
  | "pdf"
  | "image"
  | "video"
  | "presentation"
  | "document"
  | "sheet"
  | "text"
  | "data"
  | "code"
  | "archive"
  | "other";

const CODE_EXTENSIONS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "py",
  "c",
  "cpp",
  "h",
  "java",
  "sql",
  "css",
  "html",
]);

export function fileKind(mimeType: string, originalName: string): FileKind {
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.includes("presentationml")) return "presentation";
  if (
    mimeType.includes("wordprocessingml") ||
    mimeType.includes("msword") ||
    mimeType.includes("wps-office.wps") ||
    mimeType.includes("vnd.apple.pages") ||
    mimeType.includes("vnd.apple.keynote")
  ) {
    return "document";
  }
  if (
    mimeType.includes("spreadsheetml") ||
    mimeType.includes("ms-excel") ||
    mimeType.includes("wps-office.et") ||
    mimeType.includes("vnd.apple.numbers")
  ) {
    return "sheet";
  }
  const extension = originalName.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "md" || extension === "txt") return "text";
  if (extension === "csv" || extension === "json") return "data";
  if (CODE_EXTENSIONS.has(extension)) return "code";
  if (["zip", "rar", "7z", "tar", "gz"].includes(extension)) return "archive";
  return "other";
}

export function FileKindIcon({
  mimeType,
  originalName,
  size = 18,
}: {
  mimeType: string;
  originalName: string;
  size?: number;
}) {
  const props = { width: size, height: size, strokeWidth: 1.7 } as const;
  switch (fileKind(mimeType, originalName)) {
    case "pdf":
      return <Page {...props} className="text-[var(--color-error)]" />;
    case "image":
      return <MediaImage {...props} className="text-[var(--color-success)]" />;
    case "video":
      return <MediaVideo {...props} className="text-[var(--color-accent)]" />;
    case "presentation":
      return <MultiplePages {...props} className="text-[var(--color-warning)]" />;
    case "document":
      return <Journal {...props} className="text-[var(--color-accent)]" />;
    case "sheet":
      return <Table {...props} className="text-[var(--color-success)]" />;
    case "code":
      return <Code {...props} className="text-[var(--color-accent)]" />;
    case "archive":
      return <Compress {...props} className="text-[var(--color-warning)]" />;
    default:
      return <Page {...props} className="text-[var(--color-text-tertiary)]" />;
  }
}
