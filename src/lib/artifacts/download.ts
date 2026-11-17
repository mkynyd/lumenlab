/** This contract is shared by the renderer, event replay and chat. */
export const artifactDownloadFormats = {
  markdown: { extension: "md", label: "Markdown", mimeType: "text/markdown; charset=utf-8" },
  docx: { extension: "docx", label: "Word", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  pdf: { extension: "pdf", label: "PDF", mimeType: "application/pdf" },
  xlsx: { extension: "xlsx", label: "Excel", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  pptx: { extension: "pptx", label: "PowerPoint", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
} as const;

export type ArtifactDownloadFormat = keyof typeof artifactDownloadFormats;
export function isArtifactDownloadFormat(value: unknown): value is ArtifactDownloadFormat {
  return typeof value === "string" && Object.hasOwn(artifactDownloadFormats, value);
}

export interface ArtifactDownload {
  artifactId: string;
  format: ArtifactDownloadFormat;
  filename: string;
  downloadUrl: string;
  bytes?: number;
}

export function artifactDownloadUrl(id: string, format: ArtifactDownloadFormat) {
  return `/api/artifacts/${encodeURIComponent(id)}/export?format=${format}`;
}

export function readArtifactDownload(result: Record<string, unknown>): ArtifactDownload | undefined {
  const { artifactId, format, filename, downloadUrl, bytes } = result;
  if (typeof artifactId !== "string" || !/^[\w-]{1,200}$/.test(artifactId) ||
      !isArtifactDownloadFormat(format) || typeof filename !== "string" ||
      filename.length > 260 || /[\u0000-\u001f/\\]/.test(filename) ||
      !filename.endsWith(`.${artifactDownloadFormats[format].extension}`) ||
      downloadUrl !== artifactDownloadUrl(artifactId, format)) return undefined;
  return {
    artifactId, format, filename, downloadUrl,
    ...(typeof bytes === "number" && Number.isSafeInteger(bytes) && bytes > 0 ? { bytes } : {}),
  };
}
