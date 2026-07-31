import { describe, expect, it } from "vitest";

import type { ProgressEvaluation } from "./progress-projector";
import type { WrongAnswerAttempt } from "./wrong-answer";
import { deriveWrongAnswer } from "./index";

const start = new Date("2026-07-31T00:00:00.000Z");

function attempt(
  id: string,
  secondsAfterStart: number,
  overrides: Partial<WrongAnswerAttempt> = {},
): WrongAnswerAttempt {
  return {
    id,
    itemLineageId: "lineage-1",
    mode: "evidence_bearing",
    assistanceLevel: "independent",
    spacingSeconds: 24 * 60 * 60,
    submittedAt: new Date(start.getTime() + secondsAfterStart * 1_000),
    ...overrides,
  };
}

function evaluation(
  id: string,
  attemptId: string,
  verdict: ProgressEvaluation["verdict"],
): ProgressEvaluation {
  return {
    id,
    attemptId,
    supersedesEvaluationId: null,
    createdAt: new Date(start.getTime() + Number(id.slice(1)) * 1_000),
    verdict,
    score:
      verdict === "correct" ? 1 : verdict === "partial" ? 0.5 : 0,
    rubric: null,
    confidence: 1,
    errorType: verdict === "correct" ? null : "knowledge_gap",
    reason: "fixture",
  };
}

describe("deriveWrongAnswer", () => {
  it("does not create a duplicate collection entry when no wrong verdict exists", () => {
    expect(
      deriveWrongAnswer({
        itemLineageId: "lineage-1",
        attempts: [attempt("a1", 1)],
        evaluations: [evaluation("e1", "a1", "correct")],
      }),
    ).toEqual({
      policyVersion: "wrong-answer-v1",
      itemLineageId: "lineage-1",
      included: false,
      status: "not_in_collection",
      triggeringAttemptIds: [],
      resolutionAttemptIds: [],
      latestVerdict: "correct",
    });
  });

  it("keeps an immediate answer-exposed redo unresolved", () => {
    const result = deriveWrongAnswer({
      itemLineageId: "lineage-1",
      attempts: [
        attempt("a1", 1, { spacingSeconds: 0 }),
        attempt("a2", 2, {
          assistanceLevel: "answer_exposed",
          spacingSeconds: 20,
        }),
      ],
      evaluations: [
        evaluation("e1", "a1", "incorrect"),
        evaluation("e2", "a2", "correct"),
      ],
    });

    expect(result).toMatchObject({
      included: true,
      status: "unresolved",
      triggeringAttemptIds: ["a1"],
      resolutionAttemptIds: [],
      latestVerdict: "correct",
    });
  });

  it("resolves from later strong same-item evidence without requiring a variant", () => {
    const result = deriveWrongAnswer({
      itemLineageId: "lineage-1",
      attempts: [
        attempt("a1", 1, { spacingSeconds: 0 }),
        attempt("a2", 2 * 24 * 60 * 60, {
          spacingSeconds: 2 * 24 * 60 * 60,
        }),
      ],
      evaluations: [
        evaluation("e1", "a1", "partial"),
        evaluation("e2", "a2", "correct"),
      ],
    });

    expect(result).toMatchObject({
      included: true,
      status: "resolved",
      triggeringAttemptIds: ["a1"],
      resolutionAttemptIds: ["a2"],
      latestVerdict: "correct",
    });
  });

  it("returns to unresolved when a newer wrong verdict follows an older resolution", () => {
    const result = deriveWrongAnswer({
      itemLineageId: "lineage-1",
      attempts: [
        attempt("a1", 1),
        attempt("a2", 2 * 24 * 60 * 60),
        attempt("a3", 3 * 24 * 60 * 60),
      ],
      evaluations: [
        evaluation("e1", "a1", "incorrect"),
        evaluation("e2", "a2", "correct"),
        evaluation("e3", "a3", "uncertain"),
      ],
    });

    expect(result).toMatchObject({
      included: true,
      status: "unresolved",
      triggeringAttemptIds: ["a1", "a3"],
      resolutionAttemptIds: [],
      latestVerdict: "uncertain",
    });
  });

  it("keeps resolved history visible and filters other item lineages", () => {
    const result = deriveWrongAnswer({
      itemLineageId: "lineage-1",
      attempts: [
        attempt("a0", 0, { itemLineageId: "lineage-other" }),
        attempt("a1", 1),
        attempt("a2", 2 * 24 * 60 * 60),
      ],
      evaluations: [
        evaluation("e0", "a0", "incorrect"),
        evaluation("e1", "a1", "incorrect"),
        evaluation("e2", "a2", "correct"),
      ],
    });

    expect(result).toMatchObject({
      included: true,
      status: "resolved",
      triggeringAttemptIds: ["a1"],
      resolutionAttemptIds: ["a2"],
    });
  });
});
