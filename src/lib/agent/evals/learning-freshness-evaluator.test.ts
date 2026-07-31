import { describe, expect, it } from "vitest";

import { LEARNING_FRESHNESS_FIXTURES } from "./fixtures/learning-freshness";
import {
  formatLearningFreshnessAudit,
  runLearningFreshnessEvals,
} from "./learning-freshness-evaluator";

describe("learning freshness regression audit", () => {
  it("passes unchanged, changed, deleted, and replacement fixtures", () => {
    const report = runLearningFreshnessEvals(
      LEARNING_FRESHNESS_FIXTURES,
    );

    expect(report).toMatchObject({
      total: 4,
      passed: 4,
      failed: 0,
      credentialFree: true,
    });
    expect(report.results.map((result) => result.id)).toEqual([
      "unchanged-lineage-inherits-mastery",
      "changed-source-isolated-revalidation",
      "deleted-source-becomes-unsupported",
      "replacement-source-requires-revalidation",
    ]);
    expect(
      report.results.every(
        (result) => result.historicalEvidenceBytePreserved,
      ),
    ).toBe(true);
  });

  it("formats a deterministic report without fixture evidence or credentials", () => {
    const first = formatLearningFreshnessAudit(
      runLearningFreshnessEvals(LEARNING_FRESHNESS_FIXTURES),
    );
    const second = formatLearningFreshnessAudit(
      runLearningFreshnessEvals(LEARNING_FRESHNESS_FIXTURES),
    );

    expect(second).toBe(first);
    expect(first).toContain('"credentialFree": true');
    expect(first).not.toContain("serialized");
    expect(first).not.toMatch(
      /api.?key|authorization|bearer|password|private.?key|token/i,
    );
  });
});
