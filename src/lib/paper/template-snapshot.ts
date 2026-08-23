import { createHash } from "node:crypto";
import JSZip from "jszip";
import { safeCompilePath } from "./compile-policy";

const MAX_TEMPLATE_FILES = 2_000;
const MAX_TEMPLATE_BYTES = 200 * 1024 * 1024;

export function githubRepositorySlug(repositoryUrl: string): string | null {
  try {
    const url = new URL(repositoryUrl);
    if (url.hostname.toLowerCase() !== "github.com") return null;
    const parts = url.pathname.split("/").filter(Boolean).map((part) => part.replace(/\.git$/i, ""));
    return parts.length === 2 && parts.every((part) => /^[A-Za-z0-9_.-]+$/.test(part)) ? `${parts[0]}/${parts[1]}` : null;
  } catch {
    return null;
  }
}

export async function normalizeTemplateZip(input: Buffer): Promise<{ buffer: Buffer; files: string[]; sha256: string; bytes: number }> {
  const source = await JSZip.loadAsync(input);
  const output = new JSZip();
  const files: string[] = [];
  let totalBytes = 0;
  for (const [rawName, entry] of Object.entries(source.files)) {
    if (entry.dir || rawName.startsWith("__MACOSX/")) continue;
    const normalizedName = rawName.replaceAll("\\", "/").split("/").filter(Boolean);
    if (normalizedName.length < 2) continue;
    const relativeName = safeCompilePath(normalizedName.slice(1).join("/"));
    const bytes = await entry.async("nodebuffer");
    totalBytes += bytes.byteLength;
    if (files.length >= MAX_TEMPLATE_FILES || totalBytes > MAX_TEMPLATE_BYTES) throw new Error("模板上游快照超过文件数量或大小限制");
    output.file(relativeName, bytes);
    files.push(relativeName);
  }
  const buffer = await output.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return { buffer, files: files.sort(), sha256: createHash("sha256").update(buffer).digest("hex"), bytes: buffer.byteLength };
}
