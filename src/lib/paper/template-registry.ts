export interface TemplateRegistryRecord {
  id: string;
  university: string;
  universityType?: string | null;
  degreeType?: string | null;
  year?: string | null;
  format: string;
  sourceType?: string | null;
  officialSpecUrl?: string | null;
  repositoryUrl?: string | null;
  repositoryHost?: string | null;
  version?: string | null;
  engine?: string | null;
  entryFile?: string | null;
  documentClass?: string | null;
  bibliography?: string | null;
  license?: string | null;
  maintainer?: string | null;
  lastCommit?: string | null;
  officialSpecDocUrl?: string | null;
  status?: string | null;
  recommendationLevel?: string | null;
  recommendationReason?: string | null;
  knownIssues?: string | null;
  searchedAt?: string | null;
}

export type TemplateRuntimeStatus =
  | "Verified"
  | "Compatible"
  | "Needs Review"
  | "Deprecated"
  | "Unverified";

export interface TemplateUpstreamSnapshot {
  snapshotId: string;
  repositoryUrl: string | null;
  commitOrVersion: string | null;
  sourceType: string | null;
  license: string | null;
  materialized: boolean;
  sourceFiles: string[];
  sourceArchive?: {
    provider: "local" | "qiniu";
    key: string;
    sha256: string;
    bytes: number;
    format: "zip";
  } | null;
}

export interface AcademicTemplateManifest {
  id: string;
  university: string;
  degreeType?: string | null;
  year?: string | null;
  format: string;
  engine?: string | null;
  entryFile?: string | null;
  documentClass?: string | null;
  bibliography?: string | null;
  supportedBlocks: string[];
  requiredMetadata?: string[];
  fieldMappings?: Record<string, string>;
  officialSpecUrl?: string | null;
  repositoryUrl?: string | null;
  repositoryHost?: string | null;
  license?: string | null;
  adapterId?: string | null;
  upstreamSnapshot?: TemplateUpstreamSnapshot | null;
  validation?: { status: string; lastValidatedAt?: string | null };
  sample?: { fixtureId: string; status: string };
}

export function buildGeneralAcademicTemplateManifest(): AcademicTemplateManifest {
  return {
    id: "general-academic-v1",
    university: "通用学术论文",
    format: "latex",
    engine: "xelatex",
    entryFile: "main.tex",
    documentClass: "ctexart",
    bibliography: "bibtex",
    supportedBlocks: ["paper_metadata", "abstract", "keywords", "heading", "paragraph", "figure", "table", "equation", "list", "quote", "bibliography", "appendix", "acknowledgement", "page_break", "raw_latex"],
    requiredMetadata: ["title", "authors"],
    fieldMappings: { title: "\\title", authors: "\\author", abstract: "abstract", bibliography: "references.bib" },
    adapterId: "latex-academic-v1",
    upstreamSnapshot: { snapshotId: "general-academic-v1:1", repositoryUrl: null, commitOrVersion: "1", sourceType: "builtin", license: "MIT", materialized: true, sourceFiles: ["main.tex", "generated-content.tex"], sourceArchive: null },
    validation: { status: "Verified", lastValidatedAt: null },
    sample: { fixtureId: "sample-academic-v1", status: "verified" },
  };
}

export function buildTemplateManifest(record: TemplateRegistryRecord, variantKey = `${record.id}:default`): AcademicTemplateManifest {
  const format = record.format.toLowerCase();
  const executable = format === "latex" || format === "overleaf";
  const adapterId = `${format}-academic-v1`;
  const commitOrVersion = record.version ?? record.lastCommit ?? null;
  const documentClass = record.documentClass && /^[A-Za-z][A-Za-z0-9_-]*$/.test(record.documentClass) ? record.documentClass : null;
  return {
    id: variantKey,
    university: record.university,
    degreeType: record.degreeType,
    year: record.year,
    format: record.format,
    engine: record.engine ?? (executable ? "xelatex" : null),
    entryFile: record.entryFile ?? (executable ? "main.tex" : null),
    documentClass,
    bibliography: record.bibliography,
    supportedBlocks: ["paper_metadata", "abstract", "keywords", "heading", "paragraph", "figure", "table", "equation", "list", "quote", "bibliography", "appendix", "acknowledgement", "page_break", "raw_latex"],
    requiredMetadata: ["title", "authors"],
    fieldMappings: { title: "\\title", authors: "\\author", abstract: "abstract", bibliography: "references.bib" },
    officialSpecUrl: record.officialSpecUrl,
    repositoryUrl: record.repositoryUrl,
    repositoryHost: record.repositoryHost,
    license: record.license,
    adapterId,
    upstreamSnapshot: {
      snapshotId: `${variantKey}:${commitOrVersion ?? "unversioned"}`,
      repositoryUrl: record.repositoryUrl ?? null,
      commitOrVersion,
      sourceType: record.sourceType ?? null,
      license: record.license ?? null,
      materialized: false,
      sourceFiles: [],
      sourceArchive: null,
    },
    validation: { status: "pending", lastValidatedAt: null },
    sample: { fixtureId: "sample-academic-v1", status: "pending" },
  };
}

export function normalizeTemplateManifest(value: unknown): AcademicTemplateManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("模板 Manifest 无效");
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.university !== "string" || typeof record.format !== "string") throw new Error("模板 Manifest 缺少必要字段");
  return {
    id: record.id,
    university: record.university,
    degreeType: typeof record.degreeType === "string" ? record.degreeType : null,
    year: typeof record.year === "string" ? record.year : null,
    format: record.format,
    engine: typeof record.engine === "string" ? record.engine : null,
    entryFile: typeof record.entryFile === "string" ? record.entryFile : null,
    documentClass: typeof record.documentClass === "string" ? record.documentClass : null,
    bibliography: typeof record.bibliography === "string" ? record.bibliography : null,
    supportedBlocks: Array.isArray(record.supportedBlocks) ? record.supportedBlocks.filter((item): item is string => typeof item === "string") : [],
    requiredMetadata: Array.isArray(record.requiredMetadata) ? record.requiredMetadata.filter((item): item is string => typeof item === "string") : [],
    fieldMappings: record.fieldMappings && typeof record.fieldMappings === "object" && !Array.isArray(record.fieldMappings) ? Object.fromEntries(Object.entries(record.fieldMappings).filter((entry): entry is [string, string] => typeof entry[1] === "string")) : {},
    officialSpecUrl: typeof record.officialSpecUrl === "string" ? record.officialSpecUrl : null,
    repositoryUrl: typeof record.repositoryUrl === "string" ? record.repositoryUrl : null,
    repositoryHost: typeof record.repositoryHost === "string" ? record.repositoryHost : null,
    license: typeof record.license === "string" ? record.license : null,
    adapterId: typeof record.adapterId === "string" ? record.adapterId : null,
    upstreamSnapshot: normalizeUpstreamSnapshot(record.upstreamSnapshot),
    validation: record.validation && typeof record.validation === "object" && !Array.isArray(record.validation) ? { status: typeof (record.validation as Record<string, unknown>).status === "string" ? (record.validation as Record<string, unknown>).status as string : "pending", lastValidatedAt: typeof (record.validation as Record<string, unknown>).lastValidatedAt === "string" ? (record.validation as Record<string, unknown>).lastValidatedAt as string : null } : undefined,
    sample: record.sample && typeof record.sample === "object" && !Array.isArray(record.sample) && typeof (record.sample as Record<string, unknown>).fixtureId === "string" ? { fixtureId: (record.sample as Record<string, unknown>).fixtureId as string, status: typeof (record.sample as Record<string, unknown>).status === "string" ? (record.sample as Record<string, unknown>).status as string : "pending" } : undefined,
  };
}

function normalizeUpstreamSnapshot(value: unknown): TemplateUpstreamSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.snapshotId !== "string") return null;
  return {
    snapshotId: record.snapshotId,
    repositoryUrl: typeof record.repositoryUrl === "string" ? record.repositoryUrl : null,
    commitOrVersion: typeof record.commitOrVersion === "string" ? record.commitOrVersion : null,
    sourceType: typeof record.sourceType === "string" ? record.sourceType : null,
    license: typeof record.license === "string" ? record.license : null,
    materialized: record.materialized === true,
    sourceFiles: Array.isArray(record.sourceFiles) ? record.sourceFiles.filter((item): item is string => typeof item === "string") : [],
    sourceArchive: record.sourceArchive && typeof record.sourceArchive === "object" && !Array.isArray(record.sourceArchive)
      ? {
          provider: (record.sourceArchive as Record<string, unknown>).provider === "qiniu" ? "qiniu" : "local",
          key: typeof (record.sourceArchive as Record<string, unknown>).key === "string" ? (record.sourceArchive as Record<string, unknown>).key as string : "",
          sha256: typeof (record.sourceArchive as Record<string, unknown>).sha256 === "string" ? (record.sourceArchive as Record<string, unknown>).sha256 as string : "",
          bytes: typeof (record.sourceArchive as Record<string, unknown>).bytes === "number" ? (record.sourceArchive as Record<string, unknown>).bytes as number : 0,
          format: "zip",
        }
      : null,
  };
}

export function mapTemplateRuntimeStatus(record: Pick<TemplateRegistryRecord, "status" | "format" | "repositoryUrl">): TemplateRuntimeStatus {
  const status = (record.status ?? "").toLowerCase();
  if (status === "deprecated" || status === "archived") return "Deprecated";
  if (status === "active" && record.repositoryUrl && record.format.toLowerCase() === "latex") return "Compatible";
  if (status === "stale" || status === "unknown") return "Needs Review";
  return "Unverified";
}

export function toTemplateRegistryRecord(value: unknown): TemplateRegistryRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("模板记录不是对象");
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.university !== "string" || typeof record.format !== "string") {
    throw new Error("模板记录缺少 id、university 或 format");
  }
  return {
    id: record.id,
    university: record.university,
    format: record.format,
    universityType: optionalString(record.universityType),
    degreeType: optionalString(record.degreeType),
    year: optionalString(record.year),
    sourceType: optionalString(record.sourceType),
    officialSpecUrl: optionalString(record.officialSpecUrl),
    repositoryUrl: optionalString(record.repositoryUrl),
    repositoryHost: optionalString(record.repositoryHost),
    version: optionalString(record.version),
    engine: optionalString(record.engine),
    entryFile: optionalString(record.entryFile),
    documentClass: optionalString(record.documentClass),
    bibliography: optionalString(record.bibliography),
    license: optionalString(record.license),
    maintainer: optionalString(record.maintainer),
    lastCommit: optionalString(record.lastCommit),
    officialSpecDocUrl: optionalString(record.officialSpecDocUrl),
    status: optionalString(record.status),
    recommendationLevel: optionalString(record.recommendationLevel),
    recommendationReason: optionalString(record.recommendationReason),
    knownIssues: optionalString(record.knownIssues),
    searchedAt: optionalString(record.searchedAt),
  };
}

export function parseTemplateRegistry(value: unknown): TemplateRegistryRecord[] {
  if (!Array.isArray(value)) throw new Error("templates.json 必须是数组");
  return value.map(toTemplateRegistryRecord);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
