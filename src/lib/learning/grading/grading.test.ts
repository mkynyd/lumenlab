import { describe, expect, it } from "vitest";

import type { AnswerCriteriaDto } from "../contracts";
import { gradeAttempt } from "./index";

function grade(criteria: AnswerCriteriaDto, answer: unknown) {
  return gradeAttempt({
    mode: "evidence_bearing",
    answer,
    criteria,
  });
}

describe("gradeAttempt", () => {
  it("grades single-choice answers deterministically", () => {
    expect(
      grade(
        { kind: "single_choice", selectedOptionId: "b" },
        { selectedOptionId: "b" },
      ),
    ).toEqual({
      verdict: "correct",
      score: 1,
      rubric: null,
      confidence: 1,
      errorType: null,
      reason: "selected_option_matches",
    });

    expect(
      grade(
        { kind: "single_choice", selectedOptionId: "b" },
        { selectedOptionId: "a" },
      ),
    ).toMatchObject({
      verdict: "incorrect",
      score: 0,
      errorType: "knowledge_gap",
    });
  });

  it("treats multiple-choice answers as unordered sets", () => {
    const criteria: AnswerCriteriaDto = {
      kind: "multiple_choice",
      requiredOptionIds: ["a", "c"],
    };

    expect(grade(criteria, { selectedOptionIds: ["c", "a"] })).toMatchObject({
      verdict: "correct",
      score: 1,
      errorType: null,
    });
    expect(grade(criteria, { selectedOptionIds: ["a"] })).toMatchObject({
      verdict: "partial",
      score: 0.5,
      errorType: "knowledge_gap",
    });
    expect(grade(criteria, { selectedOptionIds: ["a", "a", "c"] })).toMatchObject(
      {
        verdict: "incorrect",
        score: 0,
        errorType: "reading_or_time",
      },
    );
  });

  it("normalizes boolean answers without making a model call", () => {
    const criteria: AnswerCriteriaDto = { kind: "boolean", expected: true };

    expect(grade(criteria, true)).toMatchObject({
      verdict: "correct",
      score: 1,
    });
    expect(grade(criteria, "正确")).toMatchObject({
      verdict: "correct",
      score: 1,
    });
    expect(grade(criteria, "false")).toMatchObject({
      verdict: "incorrect",
      score: 0,
    });
  });

  it("applies inclusive numeric tolerance and unit checks", () => {
    const criteria: AnswerCriteriaDto = {
      kind: "numeric",
      expected: 4,
      absoluteTolerance: 0.02,
      unit: "V",
    };

    expect(grade(criteria, "4.02 v")).toMatchObject({
      verdict: "correct",
      score: 1,
    });
    expect(grade(criteria, { value: 4.01, unit: "V" })).toMatchObject({
      verdict: "correct",
      score: 1,
    });
    expect(grade(criteria, "4.01 A")).toMatchObject({
      verdict: "incorrect",
      score: 0,
      errorType: "calculation_or_operation",
      reason: "numeric_unit_mismatch",
    });
    expect(grade(criteria, "4.03 V")).toMatchObject({
      verdict: "incorrect",
      score: 0,
      reason: "numeric_outside_tolerance",
    });
  });

  it("grades structured short answers from required keywords", () => {
    const criteria: AnswerCriteriaDto = {
      kind: "keywords",
      required: ["欧姆定律", "电压"],
      optional: ["电流"],
    };

    expect(grade(criteria, "由欧姆定律可知，电压与电流有关。")).toMatchObject({
      verdict: "correct",
      score: 1,
      errorType: null,
    });
    expect(grade(criteria, "这里只能确定欧姆定律。")).toMatchObject({
      verdict: "partial",
      score: 0.5,
      errorType: "knowledge_gap",
    });
    expect(grade(criteria, "不知道")).toMatchObject({
      verdict: "incorrect",
      score: 0,
      errorType: "knowledge_gap",
    });
  });

  it("keeps rubric/open and feedback-only answers out of automatic evidence", () => {
    const rubric: AnswerCriteriaDto = {
      kind: "rubric",
      criteria: [
        {
          label: "推理",
          description: "论证步骤完整",
          weight: 1,
        },
      ],
    };

    expect(grade(rubric, "开放作答")).toEqual({
      verdict: "uncertain",
      score: null,
      rubric: null,
      confidence: 1,
      errorType: null,
      reason: "rubric_requires_feedback",
    });
    expect(
      gradeAttempt({
        mode: "feedback_only",
        answer: { selectedOptionId: "b" },
        criteria: { kind: "single_choice", selectedOptionId: "b" },
      }),
    ).toEqual({
      verdict: "uncertain",
      score: null,
      rubric: null,
      confidence: 1,
      errorType: null,
      reason: "feedback_only_not_evidence",
    });
  });

  it("returns an immutable frozen evaluation object", () => {
    const result = grade(
      { kind: "single_choice", selectedOptionId: "b" },
      { selectedOptionId: "b" },
    );

    expect(Object.isFrozen(result)).toBe(true);
  });
});
