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
