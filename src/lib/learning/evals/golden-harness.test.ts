import { describe, expect, it } from "vitest";

import { LEARNING_GOLDEN_CASES } from "./golden-fixtures";
import { runLearningGoldenEvals } from "./index";

describe("runLearningGoldenEvals", () => {
  it("passes the frozen learning policy baseline", () => {
    const report = runLearningGoldenEvals(LEARNING_GOLDEN_CASES);

    expect(report.total).toBeGreaterThanOrEqual(6);
    expect(report).toMatchObject({
      passed: report.total,
      failed: 0,
    });
    expect(report.results.every((result) => result.passed)).toBe(true);
  });

  it("localizes a policy mismatch to the failing contract path", () => {
    const baseline = LEARNING_GOLDEN_CASES[0];
    const report = runLearningGoldenEvals([
      {
        ...baseline,
        id: "intentional-mismatch",
        expected: {
          ...baseline.expected,
          contribution: 99,
        },
      },
    ]);

    expect(report).toMatchObject({
      total: 1,
      passed: 0,
      failed: 1,
    });
    expect(report.results[0]).toMatchObject({
      id: "intentional-mismatch",
      passed: false,
    });
    expect(report.results[0].failures.join("\n")).toContain(
      "$.contribution",
    );
  });

  it("does not mutate reusable golden fixtures", () => {
    const before = JSON.stringify(LEARNING_GOLDEN_CASES);

    runLearningGoldenEvals(LEARNING_GOLDEN_CASES);

    expect(JSON.stringify(LEARNING_GOLDEN_CASES)).toBe(before);
  });
});
