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
