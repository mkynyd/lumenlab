import { createHash } from "node:crypto";

export interface EffectiveFileContentInput {
  textContent: string | null | undefined;
  enhancedContent: string | null | undefined;
  enhancementStatus: string | null | undefined;
}

export function getEffectiveFileContent(
  file: EffectiveFileContentInput
): string {
  if (
    file.enhancementStatus === "enhanced" &&
    file.enhancedContent?.trim()
  ) {
    return file.enhancedContent;
  }
  return file.textContent || "";
}

export function normalizeFingerprintContent(content: string): string {
  return content
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .trim();
}

export function computeContentFingerprint(content: string): string {
  const normalized = normalizeFingerprintContent(content);
  return `sha256:v1:${createHash("sha256").update(normalized, "utf8").digest("hex")}`;
}

export function computeEffectiveContentFingerprint(
  file: EffectiveFileContentInput
): string | null {
  const content = getEffectiveFileContent(file);
  return content.trim() ? computeContentFingerprint(content) : null;
}
