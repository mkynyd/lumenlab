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
