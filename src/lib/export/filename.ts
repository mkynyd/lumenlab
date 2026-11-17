export function safeExportFilename(title: string, extension: string): string {
  const safe = title
    .normalize("NFKC")
    .replace(/[\p{Cc}"\\/<>:*?|]+/gu, "-")
    .replace(/^\.+/g, "")
    .replace(/\.+$/g, "")
    .trim()
    .replace(/[\uD800-\uDFFF]/gu, "");
  const base = Array.from(safe).slice(0, 80).join("");
  return `${base || "artifact"}.${extension}`;
}
