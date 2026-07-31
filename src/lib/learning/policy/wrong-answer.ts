import type { EvaluationVerdict } from "../contracts";
import {
  DEFAULT_EVIDENCE_POLICY,
  evaluateEvidence,
  type EvidencePolicy,
} from "./evidence-policy";
import {
  resolveActiveEvaluation,
  type ProgressAttempt,
  type ProgressEvaluation,
} from "./progress-projector";

export type WrongAnswerAttempt = ProgressAttempt &
  Readonly<{
    itemLineageId: string;
  }>;

export type WrongAnswerPolicy = Readonly<{
  version: string;
  evidence: EvidencePolicy;
}>;

export const DEFAULT_WRONG_ANSWER_POLICY: WrongAnswerPolicy = Object.freeze({
  version: "wrong-answer-v1",
  evidence: DEFAULT_EVIDENCE_POLICY,
});

export type DeriveWrongAnswerInput = Readonly<{
  itemLineageId: string;
  attempts: readonly WrongAnswerAttempt[];
  evaluations: readonly ProgressEvaluation[];
}>;

export type WrongAnswerStatus =
  | "not_in_collection"
  | "unresolved"
  | "resolved";

export type WrongAnswerProjection = Readonly<{
  policyVersion: string;
  itemLineageId: string;
  included: boolean;
  status: WrongAnswerStatus;
  triggeringAttemptIds: readonly string[];
  resolutionAttemptIds: readonly string[];
  latestVerdict: EvaluationVerdict | null;
}>;

type EvaluatedAttempt = Readonly<{
  attempt: WrongAnswerAttempt;
  evaluation: ProgressEvaluation;
}>;

function compareAttempts(
  left: EvaluatedAttempt,
  right: EvaluatedAttempt,
): number {
  const difference =
    left.attempt.submittedAt.getTime() -
    right.attempt.submittedAt.getTime();
  return difference || left.attempt.id.localeCompare(right.attempt.id);
}
/**
 * Derives the wrong-answer collection directly from immutable attempt and
 * evaluation history. A resolved entry remains included for later review.
 */
export function deriveWrongAnswer(
  input: DeriveWrongAnswerInput,
  policy: WrongAnswerPolicy = DEFAULT_WRONG_ANSWER_POLICY,
): WrongAnswerProjection {
  const evaluatedAttempts: EvaluatedAttempt[] = [];
  for (const attempt of input.attempts) {
    if (attempt.itemLineageId !== input.itemLineageId) {
      continue;
    }
    const resolution = resolveActiveEvaluation(
      attempt.id,
      input.evaluations,
    );
    if (resolution.status === "active") {
      evaluatedAttempts.push({
        attempt,
        evaluation: resolution.evaluation,
      });
    }
  }
  evaluatedAttempts.sort(compareAttempts);

  const triggeringAttempts = evaluatedAttempts.filter(
    ({ evaluation }) => evaluation.verdict !== "correct",
  );
  const latestVerdict =
    evaluatedAttempts.at(-1)?.evaluation.verdict ?? null;

  if (triggeringAttempts.length === 0) {
    return Object.freeze({
      policyVersion: policy.version,
      itemLineageId: input.itemLineageId,
      included: false,
      status: "not_in_collection",
      triggeringAttemptIds: Object.freeze([] as string[]),
      resolutionAttemptIds: Object.freeze([] as string[]),
      latestVerdict,
    });
  }

  const latestTrigger = triggeringAttempts.at(-1);
  const latestTriggerTime = latestTrigger!.attempt.submittedAt.getTime();
  const latestTriggerId = latestTrigger!.attempt.id;
  const resolutionAttemptIds = evaluatedAttempts
    .filter(({ attempt, evaluation }) => {
      const isLater =
        attempt.submittedAt.getTime() > latestTriggerTime ||
        (attempt.submittedAt.getTime() === latestTriggerTime &&
          attempt.id.localeCompare(latestTriggerId) > 0);
      if (!isLater || evaluation.verdict !== "correct") {
        return false;
      }
      return evaluateEvidence(
        {
          mode: attempt.mode,
          verdict: evaluation.verdict,
          score: evaluation.score,
          assistanceLevel: attempt.assistanceLevel,
          spacingSeconds: attempt.spacingSeconds,
        },
        policy.evidence,
      ).eligibleForMastery;
    })
    .map(({ attempt }) => attempt.id);

  return Object.freeze({
    policyVersion: policy.version,
    itemLineageId: input.itemLineageId,
    included: true,
    status:
      resolutionAttemptIds.length > 0
        ? ("resolved" as const)
        : ("unresolved" as const),
    triggeringAttemptIds: Object.freeze(
      triggeringAttempts.map(({ attempt }) => attempt.id),
    ),
    resolutionAttemptIds: Object.freeze(resolutionAttemptIds),
    latestVerdict,
  });
}
