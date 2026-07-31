import type {
  AssistanceLevel,
  EvaluationVerdict,
  MasteryState,
  PracticeMode,
} from "../contracts";
import type { FrozenAttemptEvaluation } from "../grading";
import {
  DEFAULT_EVIDENCE_POLICY,
  evaluateEvidence,
  type EvidencePolicy,
} from "./evidence-policy";

export type ProgressAttempt = Readonly<{
  id: string;
  mode: PracticeMode;
  assistanceLevel: AssistanceLevel;
  spacingSeconds: number;
  submittedAt: Date;
}>;

export type ProgressEvaluation = FrozenAttemptEvaluation &
  Readonly<{
    id: string;
    attemptId: string;
    supersedesEvaluationId: string | null;
    createdAt: Date;
  }>;

export type ErrorTypeCorrectionEvidence = Readonly<{
  id: string;
  attemptId: string;
  errorType: string | null;
  createdAt: Date;
}>;

export type ProgressPolicy = Readonly<{
  version: string;
  masteryThreshold: number;
  minimumCorrectAttempts: number;
  minimumSpacedCorrectAttempts: number;
  evidence: EvidencePolicy;
}>;

export const DEFAULT_PROGRESS_POLICY: ProgressPolicy = Object.freeze({
  version: "progress-v1",
  masteryThreshold: 1.7,
  minimumCorrectAttempts: 2,
  minimumSpacedCorrectAttempts: 1,
  evidence: DEFAULT_EVIDENCE_POLICY,
});

export type ProgressProjectionInput = Readonly<{
  attempts: readonly ProgressAttempt[];
  evaluations: readonly ProgressEvaluation[];
  errorTypeCorrections?: readonly ErrorTypeCorrectionEvidence[];
}>;

export type ExcludedProgressAttempt = Readonly<{
  attemptId: string;
  reason: "missing_evaluation" | "evaluation_fork" | "feedback_only";
}>;

export type EffectiveErrorType = Readonly<{
  attemptId: string;
  errorType: string;
  source: "evaluation" | "user_correction";
  sourceId: string;
}>;

export type ProjectedProgress = Readonly<{
  policyVersion: string;
  masteryState: MasteryState;
  score: number;
  evidenceAsOf: Date | null;
  consideredAttemptIds: readonly string[];
  activeEvaluationIds: readonly string[];
  excludedAttempts: readonly ExcludedProgressAttempt[];
  correctAttemptCount: number;
  spacedCorrectAttemptCount: number;
  effectiveErrorTypes: readonly EffectiveErrorType[];
}>;

export type ChainResolution =
  | Readonly<{ status: "missing" }>
  | Readonly<{ status: "invalid" }>
  | Readonly<{ status: "active"; evaluation: ProgressEvaluation }>;

export function resolveActiveEvaluation(
  attemptId: string,
  allEvaluations: readonly ProgressEvaluation[],
): ChainResolution {
  const evaluations = allEvaluations.filter(
    (evaluation) => evaluation.attemptId === attemptId,
  );
  if (evaluations.length === 0) {
    return { status: "missing" };
  }

  const byId = new Map(
    evaluations.map((evaluation) => [evaluation.id, evaluation]),
  );
  if (byId.size !== evaluations.length) {
    return { status: "invalid" };
  }

  const roots = evaluations.filter(
    (evaluation) => evaluation.supersedesEvaluationId === null,
  );
  if (roots.length !== 1) {
    return { status: "invalid" };
  }

  const childrenByParent = new Map<string, ProgressEvaluation[]>();
  for (const evaluation of evaluations) {
    const parentId = evaluation.supersedesEvaluationId;
    if (parentId === null) {
      continue;
    }
    if (!byId.has(parentId)) {
      return { status: "invalid" };
    }
    const children = childrenByParent.get(parentId) ?? [];
    children.push(evaluation);
    childrenByParent.set(parentId, children);
    if (children.length > 1) {
      return { status: "invalid" };
    }
  }

  const visited = new Set<string>();
  let active = roots[0];
  while (true) {
    if (visited.has(active.id)) {
      return { status: "invalid" };
    }
    visited.add(active.id);
    const children = childrenByParent.get(active.id) ?? [];
    if (children.length === 0) {
      break;
    }
    active = children[0];
  }

  if (visited.size !== evaluations.length) {
    return { status: "invalid" };
  }
  return { status: "active", evaluation: active };
}

function maxDate(left: Date | null, right: Date): Date {
  return left === null || right.getTime() > left.getTime() ? right : left;
}

function roundScore(score: number): number {
  return Math.round(score * 1_000_000) / 1_000_000;
}

function projectErrorType(
  attemptId: string,
  evaluation: ProgressEvaluation,
  corrections: readonly ErrorTypeCorrectionEvidence[],
): EffectiveErrorType | null {
  const latestCorrection = corrections
    .filter((correction) => correction.attemptId === attemptId)
    .reduce<ErrorTypeCorrectionEvidence | null>((latest, correction) => {
      if (
        latest === null ||
        correction.createdAt.getTime() > latest.createdAt.getTime() ||
        (correction.createdAt.getTime() === latest.createdAt.getTime() &&
          correction.id.localeCompare(latest.id) > 0)
      ) {
        return correction;
      }
      return latest;
    }, null);

  if (
    latestCorrection !== null &&
    latestCorrection.createdAt.getTime() >= evaluation.createdAt.getTime()
  ) {
    return latestCorrection.errorType === null
      ? null
      : Object.freeze({
          attemptId,
          errorType: latestCorrection.errorType,
          source: "user_correction" as const,
          sourceId: latestCorrection.id,
        });
  }

  return evaluation.errorType === null
    ? null
    : Object.freeze({
        attemptId,
        errorType: evaluation.errorType,
        source: "evaluation" as const,
        sourceId: evaluation.id,
      });
}

/**
 * Pure read-model projection over immutable attempts and append-only
 * evaluations. Ambiguous regrade graphs are excluded fail-closed.
 */
export function projectProgress(
  input: ProgressProjectionInput,
  policy: ProgressPolicy = DEFAULT_PROGRESS_POLICY,
): ProjectedProgress {
  const consideredAttemptIds: string[] = [];
  const activeEvaluationIds: string[] = [];
  const excludedAttempts: ExcludedProgressAttempt[] = [];
  const effectiveErrorTypes: EffectiveErrorType[] = [];
  const corrections = input.errorTypeCorrections ?? [];

  let totalScore = 0;
  let correctAttemptCount = 0;
  let spacedCorrectAttemptCount = 0;
  let evidenceAsOf: Date | null = null;

  for (const attempt of input.attempts) {
    if (attempt.mode === "feedback_only") {
      excludedAttempts.push({
        attemptId: attempt.id,
        reason: "feedback_only",
      });
      continue;
    }

    const resolution = resolveActiveEvaluation(
      attempt.id,
      input.evaluations,
    );
    if (resolution.status !== "active") {
      excludedAttempts.push({
        attemptId: attempt.id,
        reason:
          resolution.status === "missing"
            ? "missing_evaluation"
            : "evaluation_fork",
      });
      continue;
    }

    const evaluation = resolution.evaluation;
    const evidence = evaluateEvidence(
      {
        mode: attempt.mode,
        verdict: evaluation.verdict,
        score: evaluation.score,
        assistanceLevel: attempt.assistanceLevel,
        spacingSeconds: attempt.spacingSeconds,
      },
      policy.evidence,
    );

    consideredAttemptIds.push(attempt.id);
    activeEvaluationIds.push(evaluation.id);
    totalScore += evidence.contribution;
    evidenceAsOf = maxDate(evidenceAsOf, evaluation.createdAt);

    if (evidence.correct) {
      correctAttemptCount += 1;
      if (evidence.spaced) {
        spacedCorrectAttemptCount += 1;
      }
    }

    const effectiveErrorType = projectErrorType(
      attempt.id,
      evaluation,
      corrections,
    );
    if (effectiveErrorType !== null) {
      effectiveErrorTypes.push(effectiveErrorType);
    }
  }

  const score = roundScore(Math.max(0, totalScore));
  let masteryState: MasteryState = "new";
  if (consideredAttemptIds.length > 0) {
    masteryState = "learning";
    if (
      score >= policy.masteryThreshold &&
      correctAttemptCount >= policy.minimumCorrectAttempts &&
      spacedCorrectAttemptCount >= policy.minimumSpacedCorrectAttempts
    ) {
      masteryState = "mastered";
    }
  }

  return Object.freeze({
    policyVersion: policy.version,
    masteryState,
    score,
    evidenceAsOf,
    consideredAttemptIds: Object.freeze(consideredAttemptIds),
    activeEvaluationIds: Object.freeze(activeEvaluationIds),
    excludedAttempts: Object.freeze(excludedAttempts),
    correctAttemptCount,
    spacedCorrectAttemptCount,
    effectiveErrorTypes: Object.freeze(effectiveErrorTypes),
  });
}

export function isResolvedEvaluation(
  verdict: EvaluationVerdict,
): boolean {
  return verdict === "correct";
}
