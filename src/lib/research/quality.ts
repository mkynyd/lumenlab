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
  if (["academic", "academic_paper", "arxiv", "doi", "pmid", "official_document", "dataset"].includes(sourceKind)) return 0.9;
  if (["project_file", "uploaded_file", "book"].includes(sourceKind)) return 0.8;
  if (["github", "web"].includes(sourceKind)) return 0.6;
  return 0.5;
}

/**
 * 学术引用指标作为 source quality 的有界辅助信号（正向微调，不作门槛）。
 * citationCount / influentialCitationCount / FWCI 全部缺失时返回 null（中性，
 * 不惩罚）；返回值上限 0.15，避免“引用量高 = 真”覆盖来源种类与直接性。
 */
export function academicCitationSignal(input: {
  citationCount?: number | null;
  influentialCitationCount?: number | null;
  fwci?: number | null;
}): number | null {
  const parts: number[] = [];
  if (typeof input.citationCount === "number" && Number.isFinite(input.citationCount) && input.citationCount > 0) {
    parts.push(Math.min(0.06, Math.log10(input.citationCount + 1) * 0.02));
  }
  if (typeof input.influentialCitationCount === "number" && Number.isFinite(input.influentialCitationCount) && input.influentialCitationCount > 0) {
    parts.push(Math.min(0.05, Math.log10(input.influentialCitationCount + 1) * 0.02));
  }
  if (typeof input.fwci === "number" && Number.isFinite(input.fwci) && input.fwci > 1) {
    parts.push(Math.min(0.04, (input.fwci - 1) * 0.01));
  }
  if (parts.length === 0) return null;
  return Math.min(0.15, parts.reduce((sum, value) => sum + value, 0));
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
