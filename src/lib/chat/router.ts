export interface FileAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  data: File;
}

export interface ServerFileAttachment {
  name: string;
  mimeType: string;
  size: number;
  data: Buffer;
}

const TEXT_MIME_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/html",
  "text/css",
  "text/javascript",
  "application/json",
  "application/javascript",
  "application/x-javascript",
  "application/typescript",
  "application/xml",
]);

const TEXT_EXTENSIONS = new Set([
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

function extensionOf(filename: string) {
  const index = filename.lastIndexOf(".");
  return index >= 0 ? filename.slice(index + 1).toLowerCase() : "";
}

export function isTextAttachment(
  attachment: Pick<FileAttachment | ServerFileAttachment, "name" | "mimeType">
) {
  if (TEXT_MIME_TYPES.has(attachment.mimeType)) return true;
  return TEXT_EXTENSIONS.has(extensionOf(attachment.name));
}

export function hasMultimodalContent(
  attachments: Array<Pick<FileAttachment | ServerFileAttachment, "name" | "mimeType">>
) {
  return attachments.some((attachment) => !isTextAttachment(attachment));
}

export function routeModel(
  conversation: { modelLock: string | null } | null,
  attachments: Array<Pick<FileAttachment | ServerFileAttachment, "name" | "mimeType">>,
  options: { requiresVisionModel?: boolean } = {}
): {
  provider: "deepseek" | "minimax";
  shouldLock: boolean;
} {
  if (conversation?.modelLock === "minimax") {
    return { provider: "minimax", shouldLock: false };
  }
  if (options.requiresVisionModel) {
    return { provider: "minimax", shouldLock: true };
  }
  if (hasMultimodalContent(attachments)) {
    return { provider: "minimax", shouldLock: true };
  }
  return { provider: "deepseek", shouldLock: false };
}
