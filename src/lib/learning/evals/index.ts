import { gradeAttempt, type GradeAttemptInput } from "../grading";
import {
  deriveFreshness,
  deriveWrongAnswer,
  evaluateEvidence,
  projectProgress,
  scheduleReview,
  type DeriveFreshnessInput,
  type DeriveWrongAnswerInput,
  type EvaluateEvidenceInput,
  type ProgressProjectionInput,
  type ScheduleReviewInput,
} from "../policy";

type GoldenCaseBase<
  Kind extends string,
  Input,
> = Readonly<{
  id: string;
  kind: Kind;
  input: Input;
  expected: Readonly<Record<string, unknown>>;
}>;

export type LearningGoldenEvalCase =
  | GoldenCaseBase<"grading", GradeAttemptInput>
  | GoldenCaseBase<"evidence", EvaluateEvidenceInput>
  | GoldenCaseBase<"progress", ProgressProjectionInput>
  | GoldenCaseBase<"freshness", DeriveFreshnessInput>
  | GoldenCaseBase<"wrong_answer", DeriveWrongAnswerInput>
  | GoldenCaseBase<
      "review",
      Readonly<{ schedule: ScheduleReviewInput; now: Date }>
    >;

export type GoldenEvalResult = Readonly<{
  id: string;
  kind: LearningGoldenEvalCase["kind"];
  passed: boolean;
  failures: readonly string[];
  expected: Readonly<Record<string, unknown>>;
  actual: unknown;
}>;

export type GoldenEvalReport = Readonly<{
  total: number;
  passed: number;
  failed: number;
  results: readonly GoldenEvalResult[];
}>;

function display(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  const serialized = JSON.stringify(value);
  return serialized === undefined ? String(value) : serialized;
}
function collectMismatches(
  actual: unknown,
  expected: unknown,
  path: string,
  failures: string[],
): void {
  if (expected instanceof Date) {
    if (
      !(actual instanceof Date) ||
      actual.getTime() !== expected.getTime()
    ) {
      failures.push(
        `${path} expected ${display(expected)}, received ${display(actual)}`,
      );
    }
    return;
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      failures.push(
        `${path} expected array, received ${display(actual)}`,
      );
      return;
    }
    if (actual.length !== expected.length) {
      failures.push(
        `${path}.length expected ${expected.length}, received ${actual.length}`,
      );
    }
    expected.forEach((entry, index) => {
      collectMismatches(actual[index], entry, `${path}[${index}]`, failures);
    });
    return;
  }

  if (
    typeof expected === "object" &&
    expected !== null
  ) {
    if (
      typeof actual !== "object" ||
      actual === null ||
      Array.isArray(actual)
    ) {
      failures.push(
        `${path} expected object, received ${display(actual)}`,
      );
      return;
    }
    for (const [key, value] of Object.entries(expected)) {
      collectMismatches(
        (actual as Record<string, unknown>)[key],
        value,
        `${path}.${key}`,
        failures,
      );
    }
    return;
  }

  if (!Object.is(actual, expected)) {
    failures.push(
      `${path} expected ${display(expected)}, received ${display(actual)}`,
    );
  }
}

function executeGoldenCase(testCase: LearningGoldenEvalCase): unknown {
  switch (testCase.kind) {
    case "grading":
      return gradeAttempt(testCase.input);
    case "evidence":
      return evaluateEvidence(testCase.input);
    case "progress":
      return projectProgress(testCase.input);
    case "freshness":
      return deriveFreshness(testCase.input);
    case "wrong_answer":
      return deriveWrongAnswer(testCase.input);
    case "review":
      return scheduleReview(testCase.input.schedule, {
        now: () => new Date(testCase.input.now),
      });
  }
}

/**
 * Runs deterministic, user-data-free golden policy cases. Expected objects are
 * treated as contract subsets so new diagnostic fields do not invalidate the
 * baseline, while every mismatch still reports its exact property path.
 */
export function runLearningGoldenEvals(
  cases: readonly LearningGoldenEvalCase[],
): GoldenEvalReport {
  const results = cases.map((testCase): GoldenEvalResult => {
    let actual: unknown;
    const failures: string[] = [];
    try {
      actual = executeGoldenCase(testCase);
      collectMismatches(actual, testCase.expected, "$", failures);
    } catch (error) {
      actual = null;
      failures.push(
        `$ threw ${
          error instanceof Error ? `${error.name}: ${error.message}` : display(error)
        }`,
      );
    }
    return Object.freeze({
      id: testCase.id,
      kind: testCase.kind,
      passed: failures.length === 0,
      failures: Object.freeze(failures),
      expected: testCase.expected,
      actual,
    });
  });
  const passed = results.filter((result) => result.passed).length;
  return Object.freeze({
    total: results.length,
    passed,
    failed: results.length - passed,
    results: Object.freeze(results),
  });
}
