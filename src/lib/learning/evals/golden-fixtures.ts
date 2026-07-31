import type { ProgressEvaluation } from "../policy";
import type { LearningGoldenEvalCase } from "./index";

const origin = new Date("2026-07-31T00:00:00.000Z");

const correctEvaluation = (
  id: string,
  attemptId: string,
): ProgressEvaluation => ({
  id,
  attemptId,
  supersedesEvaluationId: null,
  createdAt: new Date(
    origin.getTime() + Number(id.replace(/\D/g, "")) * 1_000,
  ),
  verdict: "correct",
  score: 1,
  rubric: null,
  confidence: 1,
  errorType: null,
  reason: "golden_fixture",
});

export const LEARNING_GOLDEN_CASES: readonly LearningGoldenEvalCase[] =
  Object.freeze([
    {
      id: "feedback-only-never-mastery-evidence",
      kind: "evidence",
      input: {
        mode: "feedback_only",
        verdict: "correct",
        score: 1,
        assistanceLevel: "independent",
        spacingSeconds: 86_400,
      },
      expected: {
        policyVersion: "evidence-v1",
        eligibleForMastery: false,
        contribution: 0,
        strength: "none",
      },
    },
    {
      id: "multiple-choice-is-an-unordered-set",
      kind: "grading",
      input: {
        mode: "evidence_bearing",
        answer: { selectedOptionIds: ["c", "a"] },
        criteria: {
          kind: "multiple_choice",
          requiredOptionIds: ["a", "c"],
        },
      },
      expected: {
        verdict: "correct",
        score: 1,
        confidence: 1,
      },
    },
    {
      id: "same-item-spaced-redo-can-master",
      kind: "progress",
      input: {
        attempts: [
          {
            id: "a1",
            mode: "evidence_bearing",
            assistanceLevel: "independent",
            spacingSeconds: 60,
            submittedAt: new Date(origin.getTime() + 1_000),
          },
          {
            id: "a2",
            mode: "evidence_bearing",
            assistanceLevel: "independent",
            spacingSeconds: 86_400,
            submittedAt: new Date(origin.getTime() + 86_400_000),
          },
        ],
        evaluations: [
          correctEvaluation("e1", "a1"),
          correctEvaluation("e2", "a2"),
        ],
      },
      expected: {
        masteryState: "mastered",
        score: 1.75,
        spacedCorrectAttemptCount: 1,
      },
    },
    {
      id: "immediate-answer-exposed-redo-does-not-resolve",
      kind: "wrong_answer",
      input: {
        itemLineageId: "lineage-1",
        attempts: [
          {
            id: "a1",
            itemLineageId: "lineage-1",
            mode: "evidence_bearing",
            assistanceLevel: "independent",
            spacingSeconds: 0,
            submittedAt: new Date(origin.getTime() + 1_000),
          },
          {
            id: "a2",
            itemLineageId: "lineage-1",
            mode: "evidence_bearing",
            assistanceLevel: "answer_exposed",
            spacingSeconds: 20,
            submittedAt: new Date(origin.getTime() + 2_000),
          },
        ],
        evaluations: [
          {
            ...correctEvaluation("e1", "a1"),
            verdict: "incorrect",
            score: 0,
            errorType: "knowledge_gap",
          },
          correctEvaluation("e2", "a2"),
        ],
      },
      expected: {
        included: true,
        status: "unresolved",
        triggeringAttemptIds: ["a1"],
        resolutionAttemptIds: [],
      },
    },
    {
      id: "changed-anchor-needs-revalidation",
      kind: "freshness",
      input: {
        anchors: [
          {
            anchorId: "anchor-1",
            recordedFingerprint: "sha256:old",
            currentFingerprint: "sha256:new",
          },
        ],
      },
      expected: {
        freshness: "needs_revalidation",
        changedAnchorIds: ["anchor-1"],
        preservesHistoricalEvidence: true,
        evidenceEligible: false,
      },
    },
    {
      id: "mastered-remains-scheduled",
      kind: "review",
      input: {
        now: new Date(origin),
        schedule: {
          masteryState: "mastered",
          verdict: "correct",
          assistanceLevel: "independent",
          spacingSeconds: 86_400,
          freshness: "current",
          successfulReviewCount: 0,
        },
      },
      expected: {
        policyVersion: "review-v1",
        reviewState: "scheduled",
        reason: "independent_success",
      },
    },
    {
      id: "rubric-remains-uncertain",
      kind: "grading",
      input: {
        mode: "evidence_bearing",
        answer: "开放论证",
        criteria: {
          kind: "rubric",
          criteria: [
            {
              label: "reasoning",
              description: "complete reasoning",
              weight: 1,
            },
          ],
        },
      },
      expected: {
        verdict: "uncertain",
        score: null,
        reason: "rubric_requires_feedback",
      },
    },
  ] satisfies LearningGoldenEvalCase[]);
