import { describe, expect, it } from "vitest";

import { gateHighConfidenceGeneration } from "../quality-gate";
import type { ParseQualityReport } from "../quality-checker";

function report(overrides: Partial<ParseQualityReport>): ParseQualityReport {
  return {
    textCoverageRatio: 1,
    imageRetainedCount: 0,
    imageAnalyzedCount: 0,
    imageSkippedCount: 0,
    failedImageCount: 0,
    tableCount: 0,
    formulaCount: 0,
    warningCount: 0,
    checks: [],
    ...overrides,
  };
}

describe("gateHighConfidenceGeneration", () => {
  it("allows healthy reports", () => {
    expect(gateHighConfidenceGeneration(report({}))).toEqual({ allowed: true });
    expect(
      gateHighConfidenceGeneration(
        report({ textCoverageRatio: 0.51, failedImageCount: 3, warningCount: 10 })
      )
    ).toEqual({ allowed: true });
  });

  it("allows missing reports for legacy parses", () => {
    expect(gateHighConfidenceGeneration(null)).toEqual({ allowed: true });
    expect(gateHighConfidenceGeneration(undefined)).toEqual({ allowed: true });
  });

  it("rejects low text coverage", () => {
    const decision = gateHighConfidenceGeneration(
      report({ textCoverageRatio: 0.49 })
    );
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toContain("覆盖率");
  });

  it("rejects too many failed images", () => {
    const decision = gateHighConfidenceGeneration(
      report({ failedImageCount: 4 })
    );
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toContain("图片");
  });

  it("rejects excessive warnings", () => {
    const decision = gateHighConfidenceGeneration(
      report({ warningCount: 11 })
    );
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toContain("告警");
  });

  it("honors custom thresholds", () => {
    expect(
      gateHighConfidenceGeneration(report({ textCoverageRatio: 0.49 }), {
        minTextCoverage: 0.4,
      })
    ).toEqual({ allowed: true });
    expect(
      gateHighConfidenceGeneration(report({ textCoverageRatio: 0.39 }), {
        minTextCoverage: 0.4,
      })
    ).toMatchObject({ allowed: false });
  });
});
