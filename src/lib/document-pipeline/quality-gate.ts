import type { ParseQualityReport } from "./quality-checker";

export type QualityGateDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

export interface QualityGateOptions {
  minTextCoverage?: number;
  maxFailedImages?: number;
  maxWarnings?: number;
}

/**
 * P1-C quality gate: low-quality parses must not feed high-confidence learning
 * generation (knowledge maps, diagnostic items, study pack sections).
 *
 * A missing report (legacy files parsed before reports existed) is allowed —
 * the gate only applies to parses that actually produced a report.
 */
export function gateHighConfidenceGeneration(
  report: ParseQualityReport | null | undefined,
  options: QualityGateOptions = {}
): QualityGateDecision {
  if (!report) return { allowed: true };

  const {
    minTextCoverage = 0.5,
    maxFailedImages = 3,
    maxWarnings = 10,
  } = options;

  if (report.textCoverageRatio < minTextCoverage) {
    return {
      allowed: false,
      reason: `解析文本覆盖率不足（${Math.round(
        report.textCoverageRatio * 100
      )}%）`,
    };
  }
  if (report.failedImageCount > maxFailedImages) {
    return {
      allowed: false,
      reason: `有 ${report.failedImageCount} 张图片解析失败`,
    };
  }
  if (report.warningCount > maxWarnings) {
    return {
      allowed: false,
      reason: `解析告警过多（${report.warningCount} 条）`,
    };
  }
  return { allowed: true };
}
