import { createHash } from "node:crypto";
import { basename } from "node:path";
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

export interface DtxBootstrapPlan {
  installerSource: string;
  outputFiles: string[];
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
  if (explicit) return explicit;

  const candidates = files
    .filter((file) => /\.(?:cls|ins|dtx)$/i.test(file.path))
    .map((file) => ({ path: file.path, name: validDocumentClass(basename(file.path)) }))
    .filter((file): file is { path: string; name: string } => Boolean(file.name))
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
  const unique = [...new Map([...declared, ...candidates].map((candidate) => [candidate.name, candidate])).values()];
  if (unique.length === 0) return null;

  const hints = hintTokens(manifest);
  const scored = unique.map((candidate) => {
    const normalizedName = candidate.name.toLowerCase();
    const normalizedPath = candidate.path.toLowerCase();
    let score = 0;
    if (!candidate.path.includes("/")) score += 8;
    if (normalizedName.includes("thesis") || normalizedName.includes("dissert")) score += 6;
    if (normalizedPath.includes("dependency") || normalizedPath.includes("/base/") || normalizedPath.includes("/ctex/")) score -= 20;
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
  return declaredGeneric?.name ?? null;
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
  if (["thuthesis", "xjtuthesis", "hithesis", "shtthesis"].includes(normalized)) return [degree];
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
    .filter((file) => /\.(?:cls|sty|dtx)$/i.test(file.path) && file.buffer)
    .map((file) => stripLatexComments(file.buffer!.toString("utf8")))
    .join("\n");
  const classUsesBiblatex = /\\(?:RequirePackage|usepackage)\s*(?:\[[^\]]*\])?\s*\{\s*biblatex\s*\}/i.test(classSources);
  if (classUsesBiblatex && !/biber|biblatex/i.test(manifest.bibliography ?? "")) return { ...manifest, bibliography: "biblatex" };
  if (!/biber|biblatex/i.test(manifest.bibliography ?? "")) return manifest;
  if (classUsesBiblatex) return manifest;
  if (/\\(?:RequirePackage|usepackage)\s*(?:\[[^\]]*\])?\s*\{\s*natbib\s*\}/i.test(classSources)) {
    return { ...manifest, bibliography: "bibtex" };
  }
  return manifest;
}

function stripLatexComments(source: string): string {
  return source.replace(/(^|[^\\])%[^\n]*/g, "$1");
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
  const output = new JSZip();
  const sortedEntries = entries.sort((left, right) => left.path.localeCompare(right.path));
  const files = sortedEntries.map((entry) => entry.path);
  for (const entry of sortedEntries) {
    output.file(entry.path, entry.bytes, { date: new Date(0), createFolders: false });
  }
  const buffer = await output.generateAsync({ type: "nodebuffer", compression: "DEFLATE", platform: "UNIX" });
  return { buffer, files: files.sort(), sha256: createHash("sha256").update(buffer).digest("hex"), bytes: buffer.byteLength };
}
