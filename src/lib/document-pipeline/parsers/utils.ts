export const MAX_MINERU_FILE_BYTES = 200 * 1024 * 1024;

export function extensionOf(filename: string): string {
  const index = filename.lastIndexOf(".");
  return index >= 0 ? filename.slice(index + 1).toLowerCase() : "";
}
