import { createHash } from "node:crypto";
import { basename } from "node:path";
import { gunzipSync } from "node:zlib";
import JSZip from "jszip";
import { safeCompilePath } from "./compile-policy";
import type { AcademicTemplateManifest } from "./template-registry";

const MAX_TEMPLATE_FILES = 2_000;
const MAX_TEMPLATE_BYTES = 200 * 1024 * 1024;
const GENERIC_DOCUMENT_CLASSES = new Set([
  "article",
  "book",
  "report",
  "letter",
  "scrartcl",
  "scrbook",
  "scrreprt",
  "ctexart",
  "ctexbook",
  "ctexrep",
  "ctexbeamer",
  "beamer",
  "IEEEtran",
]);

export interface TemplateSourceFile {
  path: string;
  buffer?: Buffer;
}

/** Find an installer that can generate the selected class, including installers
 * whose output name is derived from `\\jobname` (for example hithesis.ins). */
export function findTemplateInstaller(documentClass: string, files: TemplateSourceFile[]): TemplateSourceFile | null {
  const target = `${documentClass}.cls`.toLowerCase();
  const exact = files.find((file) => basename(file.path).toLowerCase() === `${documentClass}.ins`.toLowerCase());
  if (exact) return exact;
  for (const file of files) {
    if (!file.buffer || !/\.ins$/i.test(file.path)) continue;
    const stem = basename(file.path).replace(/\.ins$/i, "");
    const source = stripLatexComments(file.buffer.toString("utf8"));
    const outputs = [...source.matchAll(/\\file\s*\{([^}]+)\}/gi)]
      .map((match) => (match[1] ?? "").replace(/\\jobname/g, stem).replace(/\s+/g, ""))
      .map((path) => path.split("/").at(-1)?.toLowerCase() ?? "");
    if (outputs.includes(target)) return file;
  }
  return null;
}

export interface DtxBootstrapPlan {
  installerSource: string;
  outputFiles: string[];
}

/** Normalize legacy repository-relative class references for the flat compile root. */
export function normalizeTemplateRuntimeBuffer(path: string, buffer: Buffer): Buffer {
  if (!/\.(?:cls|sty)$/i.test(path)) return buffer;
  const source = buffer.toString("utf8");
  if (!source.includes("../Template/")) return buffer;
  return Buffer.from(source.replaceAll("../Template/", "Template/"), "utf8");
}

export function buildDtxBootstrapPlan(documentClass: string, dtxName: string, dtxSource: string): DtxBootstrapPlan {
  const generated = [...dtxSource.matchAll(/\\file\s*\{([^}]+)\}\s*\{\s*\\from\s*\{[^}]+\}\s*\{([^}]+)\}\s*\}/gi)]
    .map((match) => ({ output: (match[1] ?? "").replace(/\\jobname/g, documentClass), tag: match[2] ?? "" }))
    .filter((item) => /^[A-Za-z][A-Za-z0-9_.-]*$/.test(item.output) && /^[A-Za-z][A-Za-z0-9_.-]*$/.test(item.tag));
  const outputs = generated.length > 0 ? generated : [{ output: `${documentClass}.cls`, tag: "class" }];
  const outputFiles = [...new Set(outputs.map((item) => item.output))];
  const generation = outputs.map((item) => `\\file{${item.output}}{\\from{${dtxName}}{${item.tag}}}`).join("\n");
  return {
    outputFiles,
    installerSource: `\\input docstrip.tex\n\\keepsilent\n\\askforoverwritefalse\n\\preamble\nLumenLab pinned Template Pack bootstrap.\n\\endpreamble\n\\generate{\n${generation}\n}\\endbatchfile\n`,
  };
}

export async function normalizeTemplateEntries(entries: Array<{ path: string; bytes: Buffer }>): Promise<{ buffer: Buffer; files: string[]; sha256: string; bytes: number }> {
  let totalBytes = 0;
  if (entries.length > MAX_TEMPLATE_FILES) throw new Error("模板上游快照超过文件数量或大小限制");
  for (const entry of entries) {
    safeCompilePath(entry.path);
    totalBytes += entry.bytes.byteLength;
    if (totalBytes > MAX_TEMPLATE_BYTES) throw new Error("模板上游快照超过文件数量或大小限制");
  }
  const output = new JSZip();
  const sortedEntries = entries.sort((left, right) => left.path.localeCompare(right.path));
  const files = sortedEntries.map((entry) => entry.path);
  for (const entry of sortedEntries) output.file(entry.path, entry.bytes, { date: new Date(0), createFolders: false });
  const buffer = await output.generateAsync({ type: "nodebuffer", compression: "DEFLATE", platform: "UNIX" });
  return {
    buffer,
    files: [...files].sort(),
    sha256: createHash("sha256").update(buffer).digest("hex"),
    bytes: buffer.byteLength,
  };
}

function tarString(header: Buffer, start: number, length: number): string {
  return header.subarray(start, start + length).toString("utf8").replace(/\0.*$/, "").trim();
}

function tarOctal(header: Buffer, start: number, length: number): number {
  const value = tarString(header, start, length).replace(/[^0-7]/g, "");
  const parsed = value ? Number.parseInt(value, 8) : 0;
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("模板 tar.gz 包含无效文件大小");
  return parsed;
}

/** Normalize a public Typst package tar.gz into the same deterministic zip format as Git snapshots. */
export function normalizeTemplateTarGz(input: Buffer): Promise<{ buffer: Buffer; files: string[]; sha256: string; bytes: number }> {
  const tar = gunzipSync(input);
  const entries: Array<{ path: string; bytes: Buffer }> = [];
  for (let offset = 0; offset + 512 <= tar.byteLength;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = tarString(header, 0, 100);
    const prefix = tarString(header, 345, 155);
    const size = tarOctal(header, 124, 12);
    const type = header[156];
    const contentStart = offset + 512;
    const contentEnd = contentStart + size;
    if (contentEnd > tar.byteLength) throw new Error("模板 tar.gz 包含越界文件");
    if ((type === 0 || type === 48) && name) {
      const path = safeCompilePath(prefix ? `${prefix}/${name}` : name);
      entries.push({ path, bytes: tar.subarray(contentStart, contentEnd) });
    }
    offset = contentStart + Math.ceil(size / 512) * 512;
  }
  return normalizeTemplateEntries(entries);
}

export function isSystemDocumentClass(value: string | null | undefined): boolean {
  return Boolean(value && GENERIC_DOCUMENT_CLASSES.has(value));
}

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

export function isLatexTemplateFormat(format: string | null | undefined): boolean {
  const normalized = format?.trim().toLowerCase();
  return normalized === "latex" || normalized === "overleaf";
}

function validDocumentClass(value: string): string | null {
  const normalized = value.replace(/\.(?:cls|ins)$/i, "").split("/").at(-1) ?? "";
  return /^[A-Za-z][A-Za-z0-9_-]*$/.test(normalized) ? normalized : null;
}

function hintTokens(manifest: Pick<AcademicTemplateManifest, "id" | "university" | "repositoryUrl">): string[] {
  return [manifest.id, manifest.university, manifest.repositoryUrl ?? ""]
    .join(" ")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3);
}

/**
 * Resolve a class from a pinned snapshot only when the registry metadata does
 * not provide one. This never mutates registry metadata or treats a generic
 * class as a school template.
 */
export function resolveTemplateDocumentClass(
  manifest: Pick<AcademicTemplateManifest, "documentClass" | "id" | "university" | "repositoryUrl">,
  files: TemplateSourceFile[],
): string | null {
  const explicit = manifest.documentClass ? validDocumentClass(manifest.documentClass) : null;
  const explicitFilename = explicit ? files.filter((file) => /\.cls$/i.test(file.path)).map((file) => validDocumentClass(basename(file.path))).find((name) => name?.toLowerCase() === explicit.toLowerCase()) : null;
  const explicitDeclared = Boolean(explicit && files.some((file) => {
    const filenameClass = /\.cls$/i.test(file.path) ? validDocumentClass(basename(file.path)) : null;
    if (filenameClass?.toLowerCase() === explicit.toLowerCase()) return true;
    if (!file.buffer) return false;
    return new RegExp(`\\\\Provides(?:Expl)?Class\\s*\\{${explicit}\\}`, "i").test(stripLatexComments(file.buffer.toString("utf8")));
  }));
  // Registry metadata can point at a historical class name while the pinned
  // snapshot contains the maintained implementation under a slightly
  // different name (for example `bnu-thesis` vs `bnuthesis`). Prefer the
  // executable source when the explicit class is absent; keep system classes
  // and exact sources authoritative.
  if (explicitFilename) return explicitFilename;
  if (explicit && (isSystemDocumentClass(explicit) || explicitDeclared)) return explicit;

  const generatedClasses = files.flatMap((file) => {
    if (!file.buffer || !/\.ins$/i.test(file.path)) return [];
    const source = stripLatexComments(file.buffer.toString("utf8"));
    return [...source.matchAll(/\\file\s*\{([^}]+\.cls)\}/gi)]
      .map((match) => {
        const output = (match[1] ?? "").replace(/\\jobname/g, explicit ?? "").replace(/\s+/g, "");
        return { path: file.path, name: validDocumentClass(output), generated: true };
      });
  }).filter((candidate): candidate is { path: string; name: string; generated: true } => Boolean(candidate.name));
  const candidates = files
    .filter((file) => /\.(?:cls|dtx)$/i.test(file.path))
    .map((file) => ({ path: file.path, name: validDocumentClass(basename(file.path)), generated: false }))
    .filter((file): file is { path: string; name: string; generated: false } => Boolean(file.name))
    .filter((file) => !GENERIC_DOCUMENT_CLASSES.has(file.name));
  const declared = files.flatMap((file) => {
    if (!file.buffer) return [];
    const source = stripLatexComments(file.buffer.toString("utf8"));
    const names = [
      ...source.matchAll(/\\Provides(?:Expl)?Class\s*\{([^}]+)\}/gi),
      ...source.matchAll(/\\documentclass(?:\[[^\]]*\])?\s*\{([^}]+)\}/gi),
    ].map((match) => validDocumentClass(match[1] ?? "")).filter((name): name is string => Boolean(name));
    return names.map((name) => ({ path: file.path, name }));
  });
  const unique = [...new Map([...declared.map((candidate) => ({ ...candidate, generated: false })), ...candidates, ...generatedClasses].map((candidate) => [candidate.name, candidate])).values()];
  if (unique.length === 0) return null;
  const declaredEntryClass = declared.find((candidate) => !candidate.path.includes("/") && GENERIC_DOCUMENT_CLASSES.has(candidate.name));
  if (declaredEntryClass) return declaredEntryClass.name;

  const hints = hintTokens(manifest);
  const scored = unique.map((candidate) => {
    const normalizedName = candidate.name.toLowerCase();
    const normalizedPath = candidate.path.toLowerCase();
    let score = 0;
    if (candidate.generated) score += 10;
    if (candidate.generated && /book$/i.test(normalizedName)) score += 3;
    if (!candidate.path.includes("/")) score += 8;
    if (normalizedName.includes("thesis") || normalizedName.includes("dissert")) score += 6;
    if (normalizedPath.includes("dependency") || normalizedPath.includes("/base/") || normalizedPath.includes("/ctex/") || normalizedPath.includes("/reference/") || normalizedPath.includes("/vendor/")) score -= 20;
    for (const hint of hints) {
      if (normalizedName === hint || normalizedName.includes(hint) || hint.includes(normalizedName)) score += 12;
    }
    if (/slide|backup|bak|doc|translation|undergraduate|graduate/.test(normalizedName)) score -= 4;
    return { ...candidate, score };
  });
  scored.sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));
  const custom = scored.find((candidate) => !GENERIC_DOCUMENT_CLASSES.has(candidate.name));
  if (custom) return custom.name;
  const declaredGeneric = declared.find((candidate) => GENERIC_DOCUMENT_CLASSES.has(candidate.name));
  return declaredGeneric?.name ?? explicit ?? null;
}

function degreeToken(value: string | null | undefined): "bachelor" | "master" | "doctor" | null {
  const normalized = value ?? "";
  if (normalized.includes("博士") && !normalized.includes("硕士")) return "doctor";
  if (normalized.includes("本科") && !normalized.includes("硕士") && !normalized.includes("博士")) return "bachelor";
  if (normalized.includes("硕士") || normalized.includes("博士")) return "master";
  return null;
}

/**
 * Small, explicit adapter hook for common Chinese thesis classes. It only
 * supplies the degree selector that the class itself documents; all other
 * metadata remains owned by the Academic Document renderer.
 */
export function resolveTemplateClassOptions(
  manifest: Pick<AcademicTemplateManifest, "degreeType">,
  documentClass: string | null | undefined,
): string[] {
  const degree = degreeToken(manifest.degreeType);
  if (!degree || !documentClass) return [];
  const normalized = documentClass.toLowerCase();
  if (["hithesis", "hithesisbook", "hithesisart", "hithesisartplus"].includes(normalized)) return ["fontset=fandol", `type=${degree}`, "campus=harbin"];
  if (normalized === "shuthesis") return [`type=${degree === "doctor" ? "doctor" : "master"}`];
  if (normalized === "hfutthesis") return [`degree=${degree}`];
  if (["thuthesis", "xjtuthesis", "hithesis", "shtthesis", "bnuthesis"].includes(normalized)) return [degree];
  if (normalized === "seuthesiy") return [degree === "doctor" ? "phd" : degree === "bachelor" ? "engineering" : "masters"];
  if (normalized === "hhuthesis") return [degree === "doctor" ? "doctor" : degree === "bachelor" ? "bachelor" : "academicmaster"];
  if (normalized === "scuthesis2020") return [`${degree === "doctor" ? "doctor" : "master"}`, "academic"];
  if (normalized === "scuthesis") return [degree];
  if (normalized === "jnuthesis") return [degree === "doctor" ? "phd" : degree];
  if (normalized === "nuaathesis") return [`degree=${degree}`, "fontset=fandol"];
  if (["ccnuthesis", "cquthesis", "buaathesis", "buctthesis", "shuthesis", "csuthesis"].includes(normalized)) return [`type=${degree}`];
  if (["tongjithesis"].includes(normalized)) return [`degree=${degree}`];
  return [];
}

/**
 * Reconciles registry metadata with the pinned class implementation. Some
 * historical registry rows describe BibLaTeX while the pinned class still
 * loads natbib; compiling those rows with both packages creates an avoidable
 * option clash. The class source is authoritative for the executable pack.
 */
export function resolveTemplateBibliography(
  manifest: AcademicTemplateManifest,
  files: Array<{ path: string; buffer?: Buffer }>,
): AcademicTemplateManifest {
  const classSources = files
    .filter((file) => (
      /\.cls$/i.test(file.path) || isLikelyTemplateEntrySource(file, manifest)
    ) && file.buffer)
    .map((file) => stripLatexComments(file.buffer!.toString("utf8")))
    .join("\n");
  const packageSources = files
    .filter((file) => (
      /\.(?:cls|sty|dtx)$/i.test(file.path) || isLikelyTemplateEntrySource(file, manifest)
    ) && file.buffer)
    .map((file) => stripLatexComments(file.buffer!.toString("utf8")))
    .join("\n");
  if (!manifest.bibliography && manifest.documentClass?.toLowerCase() === "hfutthesis") {
    return { ...manifest, bibliography: "bibtex" };
  }
  const classUsesBiblatex = /\\(?:RequirePackage|usepackage)\s*(?:\[[^\]]*\])?\s*\{\s*biblatex\s*\}/i.test(classSources);
  const sourceRequestsBibtex = /\\(?:RequirePackage|usepackage)\s*\[[^\]]*\bbibtex\b[^\]]*\]\s*\{[^}]+\}/i.test(classSources);
  if (sourceRequestsBibtex) return { ...manifest, bibliography: "bibtex" };
  if (classUsesBiblatex && !/biber|biblatex/i.test(manifest.bibliography ?? "")) return { ...manifest, bibliography: "biblatex" };
  if (!/biber|biblatex/i.test(manifest.bibliography ?? "")) return manifest;
  if (classUsesBiblatex) return manifest;
  if (/\\(?:RequirePackage|usepackage)\s*(?:\[[^\]]*\])?\s*\{\s*natbib\s*\}/i.test(packageSources)) {
    return { ...manifest, bibliography: "bibtex" };
  }
  return manifest;
}

function stripLatexComments(source: string): string {
  return source.replace(/(^|[^\\])%[^\n]*/g, "$1");
}

function isLikelyTemplateEntrySource(file: { path: string; buffer?: Buffer }, manifest: AcademicTemplateManifest): boolean {
  if (!file.buffer || !/\.tex$/i.test(file.path)) return false;
  const source = stripLatexComments(file.buffer.toString("utf8"));
  return file.path === manifest.entryFile || (!file.path.includes("/") && /\\documentclass\b/i.test(source));
}

export async function normalizeTemplateZip(input: Buffer): Promise<{ buffer: Buffer; files: string[]; sha256: string; bytes: number }> {
  const source = await JSZip.loadAsync(input);
  const entries: Array<{ path: string; bytes: Buffer }> = [];
  let totalBytes = 0;
  for (const [rawName, entry] of Object.entries(source.files)) {
    if (entry.dir || rawName.startsWith("__MACOSX/")) continue;
    const normalizedName = rawName.replaceAll("\\", "/").split("/").filter(Boolean);
    if (normalizedName.length < 2) continue;
    const relativeName = safeCompilePath(normalizedName.slice(1).join("/"));
    const bytes = await entry.async("nodebuffer");
    totalBytes += bytes.byteLength;
    if (entries.length >= MAX_TEMPLATE_FILES || totalBytes > MAX_TEMPLATE_BYTES) throw new Error("模板上游快照超过文件数量或大小限制");
    entries.push({ path: relativeName, bytes });
  }
  return normalizeTemplateEntries(entries);
}
