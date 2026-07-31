import { describe, expect, it } from "vitest";

import type {
  ProgressAttempt,
  ProgressEvaluation,
} from "./progress-projector";
import { projectProgress } from "./index";

const baseTime = new Date("2026-07-31T00:00:00.000Z");

function attempt(
  id: string,
  overrides: Partial<ProgressAttempt> = {},
): ProgressAttempt {
  return {
    id,
    mode: "evidence_bearing",
    assistanceLevel: "independent",
    spacingSeconds: 24 * 60 * 60,
    submittedAt: new Date(baseTime.getTime() + Number(id.replace(/\D/g, "")) * 1_000),
    ...overrides,
  };
}

function evaluation(
  id: string,
  attemptId: string,
  overrides: Partial<ProgressEvaluation> = {},
): ProgressEvaluation {
  return {
    id,
    attemptId,
    supersedesEvaluationId: null,
    createdAt: new Date(baseTime.getTime() + Number(id.replace(/\D/g, "")) * 2_000),
    verdict: "correct",
    score: 1,
    rubric: null,
    confidence: 1,
    errorType: null,
    reason: "fixture",
    ...overrides,
  };
}

describe("projectProgress", () => {
  it("uses only the leaf of a linear append-only re-evaluation chain", () => {
    const original = evaluation("e1", "a1", {
      verdict: "incorrect",
      score: 0,
      errorType: "knowledge_gap",
    });
    const regrade = evaluation("e2", "a1", {
      supersedesEvaluationId: "e1",
      verdict: "correct",
      score: 1,
      errorType: null,
    });

    const result = projectProgress({
      attempts: [attempt("a1")],
      evaluations: [original, regrade],
    });

    expect(result).toMatchObject({
      masteryState: "learning",
      consideredAttemptIds: ["a1"],
      activeEvaluationIds: ["e2"],
      correctAttemptCount: 1,
      spacedCorrectAttemptCount: 1,
    });
    expect(result.effectiveErrorTypes).toEqual([]);
    expect(original).toMatchObject({
      verdict: "incorrect",
      errorType: "knowledge_gap",
    });
  });

  it("fails closed when an evaluation chain forks", () => {
    const result = projectProgress({
      attempts: [attempt("a1")],
      evaluations: [
        evaluation("e1", "a1"),
        evaluation("e2", "a1", { supersedesEvaluationId: "e1" }),
        evaluation("e3", "a1", { supersedesEvaluationId: "e1" }),
      ],
    });

    expect(result).toMatchObject({
      masteryState: "new",
      consideredAttemptIds: [],
      activeEvaluationIds: [],
      excludedAttempts: [
        { attemptId: "a1", reason: "evaluation_fork" },
      ],
    });
  });

  it("allows two same-item attempts to establish mastery when one is actually spaced", () => {
    const result = projectProgress({
      attempts: [
        attempt("a1", { spacingSeconds: 60 }),
        attempt("a2", { spacingSeconds: 24 * 60 * 60 }),
      ],
      evaluations: [evaluation("e1", "a1"), evaluation("e2", "a2")],
    });

    expect(result).toMatchObject({
      masteryState: "mastered",
      score: 1.75,
      correctAttemptCount: 2,
      spacedCorrectAttemptCount: 1,
    });
  });

  it("does not master from repeated immediate answer-exposed redos alone", () => {
    const attempts = Array.from({ length: 40 }, (_, index) =>
      attempt(`a${index + 1}`, {
        assistanceLevel: "answer_exposed",
        spacingSeconds: 15,
      }),
    );
    const evaluations = attempts.map((entry, index) =>
      evaluation(`e${index + 1}`, entry.id),
    );

    expect(projectProgress({ attempts, evaluations })).toMatchObject({
      masteryState: "learning",
      score: 2,
      correctAttemptCount: 40,
      spacedCorrectAttemptCount: 0,
    });
  });

  it("never promotes feedback-only attempts and reports missing evaluations", () => {
    const result = projectProgress({
      attempts: [
        attempt("a1", { mode: "feedback_only" }),
        attempt("a2"),
      ],
      evaluations: [evaluation("e1", "a1")],
    });

    expect(result).toMatchObject({
      masteryState: "new",
      excludedAttempts: [
        { attemptId: "a1", reason: "feedback_only" },
        { attemptId: "a2", reason: "missing_evaluation" },
      ],
    });
  });

  it("projects a user error-type correction without mutating evaluation history", () => {
    const source = evaluation("e1", "a1", {
      verdict: "incorrect",
      score: 0,
      errorType: "knowledge_gap",
    });
    const result = projectProgress({
      attempts: [attempt("a1")],
      evaluations: [source],
      errorTypeCorrections: [
        {
          id: "c1",
          attemptId: "a1",
          errorType: "reading_or_time",
          createdAt: new Date("2026-07-31T01:00:00.000Z"),
        },
      ],
    });

    expect(result.effectiveErrorTypes).toEqual([
      {
        attemptId: "a1",
        errorType: "reading_or_time",
        source: "user_correction",
        sourceId: "c1",
      },
    ]);
    expect(source.errorType).toBe("knowledge_gap");
  });
});
