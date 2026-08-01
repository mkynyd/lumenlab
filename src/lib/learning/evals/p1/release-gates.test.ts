import { describe, expect, it } from "vitest";

import {
  compareReleaseGates,
  runLearningReleaseGates,
} from "./release-gates";

describe("runLearningReleaseGates", () => {
  it("passes the frozen deterministic release gates across all five domains", () => {
    const report = runLearningReleaseGates({
      environment: "ci",
      ranAt: "2026-08-01T00:00:00.000Z",
    });

    expect(report.summary.failed).toBe(0);
    expect(report.summary.passed).toBe(report.summary.total);
    expect(Object.keys(report.byGate).sort()).toEqual([
      "answer_leakage",
      "authorization",
      "idempotency",
      "projection",
      "source_integrity",
    ]);
    for (const bucket of Object.values(report.byGate)) {
      expect(bucket.passed).toBe(bucket.total);
    }
  });

  it("emits an anonymized run manifest with no user data", () => {
    const report = runLearningReleaseGates({
      environment: "local",
      ranAt: "2026-08-01T00:00:00.000Z",
    });
    expect(report.manifest).toMatchObject({
      runner: "learning-release-gates",
      version: "1",
      anonymized: true,
      environment: "local",
      model: "deterministic",
    });
    expect(JSON.stringify(report)).not.toContain("userId");
    expect(JSON.stringify(report)).not.toContain("password");
  });
});

describe("compareReleaseGates", () => {
  it("blocks the release when a baseline-passing gate regresses", () => {
    const baseline = runLearningReleaseGates({
      environment: "local",
      ranAt: "2026-07-01T00:00:00.000Z",
    });
    // Simulate a candidate where the model-output strictness case regressed.
    const candidate = runLearningReleaseGates({
      environment: "local",
      ranAt: "2026-08-01T00:00:00.000Z",
    });
    const regressed = {
      ...candidate,
      results: candidate.results.map((result) =>
        result.id === "leakage-model-output-rejects-unknown-fields"
          ? { ...result, passed: false, detail: "unknown fields accepted" }
          : result,
      ),
    } as typeof candidate;

    const comparison = compareReleaseGates(baseline, regressed);
    expect(comparison.regressions).toHaveLength(1);
    expect(comparison.regressions[0].id).toBe(
      "leakage-model-output-rejects-unknown-fields",
    );
    expect(comparison.improvements).toHaveLength(0);
  });

  it("tracks improvements and new failing cases as regressions", () => {
    const baseline = runLearningReleaseGates({
      environment: "local",
      ranAt: "2026-07-01T00:00:00.000Z",
    });
    const failing = {
      ...baseline,
      results: baseline.results.map((result) =>
        result.id === "auth-regrade-rejects-injected-ownership"
          ? { ...result, passed: false }
          : result,
      ),
      summary: {
        total: baseline.summary.total,
        passed: baseline.summary.passed - 1,
        failed: baseline.summary.failed + 1,
      },
    } as typeof baseline;

    // Baseline failed case now passes → improvement.
    const improved = {
      ...failing,
      results: failing.results.map((result) =>
        result.id === "auth-regrade-rejects-injected-ownership"
          ? { ...result, passed: true }
          : result,
      ),
      summary: baseline.summary,
    } as typeof baseline;

    const baselineComparison = compareReleaseGates(baseline, failing);
    expect(baselineComparison.regressions).toHaveLength(1);
    expect(baselineComparison.regressions[0].id).toBe(
      "auth-regrade-rejects-injected-ownership",
    );

    const fixedComparison = compareReleaseGates(failing, improved);
    expect(fixedComparison.improvements).toHaveLength(1);
    expect(fixedComparison.improvements[0].id).toBe(
      "auth-regrade-rejects-injected-ownership",
    );
  });
});
