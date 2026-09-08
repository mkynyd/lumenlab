import { DEFAULT_CHAT_MODEL, providerForChatModel } from "./model-catalog";

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

/**
 * 任务 05：全部活跃模型都能看图，附件不再触发强制模型路由或模型锁。
 * 优先级：显式选择 > 旧会话 modelLock（只读兼容，不再新写）> 默认 Qwen。
 */
export function routeModel(
  conversation: { modelLock: string | null } | null,
  attachments: Array<Pick<FileAttachment | ServerFileAttachment, "name" | "mimeType">>,
  options: { requestedModel?: string } = {}
): {
  provider: "deepseek" | "minimax" | "bailian";
  shouldLock: boolean;
} {
  if (options.requestedModel) {
    const requestedProvider = providerForChatModel(options.requestedModel);
    if (requestedProvider) {
      return { provider: requestedProvider, shouldLock: false };
    }
  }
  if (conversation?.modelLock === "qwen") {
    return { provider: "bailian", shouldLock: false };
  }
  if (conversation?.modelLock === "minimax") {
    return { provider: "minimax", shouldLock: false };
  }
  return { provider: providerForChatModel(DEFAULT_CHAT_MODEL)!, shouldLock: false };
}
