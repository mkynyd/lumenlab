import type { ResearchQualityLabel } from "./contracts";

export interface ResearchQualityDimensions {
  sourceQuality: number;
  evidenceDirectness: number;
  independentCorroboration: number;
  sourceDiversity: number;
  conflict: number;
  coverage: number;
  recency: number;
}

export function clampQuality(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

export function summarizeResearchQuality(
  dimensions: ResearchQualityDimensions
): { score: number; label: ResearchQualityLabel } {
  const normalized = Object.values(dimensions).map(clampQuality);
  const score = normalized.reduce((sum, value) => sum + value, 0) / normalized.length;
  const label: ResearchQualityLabel =
    dimensions.conflict >= 0.45
      ? "存在争议"
      : score >= 0.78
        ? "证据充分"
        : score >= 0.52
          ? "中等"
          : "有限";
  return { score: Number(score.toFixed(3)), label };
}

export function computeSourceDiversity(sourceKinds: string[]): number {
  const kinds = new Set(sourceKinds.filter(Boolean));
  return Math.min(1, kinds.size / 3);
}

export function estimateSourceQuality(sourceKind: string): number {
  if (["academic", "arxiv", "official_document", "dataset"].includes(sourceKind)) return 0.9;
  if (["project_file", "uploaded_file", "book"].includes(sourceKind)) return 0.8;
  if (["github", "web"].includes(sourceKind)) return 0.6;
  return 0.5;
}

export function computeEvidenceRecency(retrievedAt: Array<Date | string | null | undefined>, now = new Date()): number {
  const dates = retrievedAt.map((value) => value ? new Date(value).getTime() : NaN).filter(Number.isFinite);
  if (dates.length === 0) return 0.5;
  const averageAgeYears = dates.reduce((sum, value) => sum + Math.max(0, now.getTime() - value) / (365.25 * 24 * 60 * 60 * 1_000), 0) / dates.length;
  return clampQuality(1 / (1 + averageAgeYears / 3));
}

export function computeResearchInformationGain(previousEvidenceCount: number, currentEvidenceCount: number): number {
  if (currentEvidenceCount <= 0 || currentEvidenceCount <= previousEvidenceCount) return 0;
  return clampQuality((currentEvidenceCount - previousEvidenceCount) / currentEvidenceCount);
}
