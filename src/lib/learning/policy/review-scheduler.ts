import {
  deriveReviewState,
  type AssistanceLevel,
  type ContentFreshness,
  type EvaluationVerdict,
  type LearningClock,
  type MasteryState,
  type ReviewState,
} from "../contracts";

const HOUR_SECONDS = 60 * 60;
const DAY_SECONDS = 24 * HOUR_SECONDS;

export type ReviewScheduleReason =
  | "unsupported"
  | "needs_revalidation"
  | "incorrect"
  | "partial"
  | "uncertain"
  | "assisted_success"
  | "independent_success";

export type ReviewPolicy = Readonly<{
  version: string;
  incorrectIntervalSeconds: number;
  partialIntervalSeconds: number;
  uncertainIntervalSeconds: number;
  answerExposedIntervalSeconds: number;
  hintedIntervalSeconds: number;
  independentLearningIntervalSeconds: number;
  independentMasteredIntervalSeconds: number;
  spacedSuccessMultiplier: number;
  streakMultiplier: number;
  maximumIntervalSeconds: number;
}>;

export const DEFAULT_REVIEW_POLICY: ReviewPolicy = Object.freeze({
  version: "review-v1",
  incorrectIntervalSeconds: 6 * HOUR_SECONDS,
  partialIntervalSeconds: 18 * HOUR_SECONDS,
  uncertainIntervalSeconds: 12 * HOUR_SECONDS,
  answerExposedIntervalSeconds: DAY_SECONDS,
  hintedIntervalSeconds: 2 * DAY_SECONDS,
  independentLearningIntervalSeconds: 3 * DAY_SECONDS,
  independentMasteredIntervalSeconds: 7 * DAY_SECONDS,
  spacedSuccessMultiplier: 1.25,
  streakMultiplier: 1.5,
  maximumIntervalSeconds: 180 * DAY_SECONDS,
});

export type ScheduleReviewInput = Readonly<{
  masteryState: MasteryState;
  verdict: EvaluationVerdict;
  assistanceLevel: AssistanceLevel;
  spacingSeconds: number;
  freshness: ContentFreshness;
  successfulReviewCount: number;
  previousIntervalSeconds?: number | null;
}>;

export type ReviewSchedule = Readonly<{
  policyVersion: string;
  reviewState: ReviewState;
  nextReviewAt: Date | null;
  intervalSeconds: number | null;
  reason: ReviewScheduleReason;
}>;

function scheduleAt(
  now: Date,
  intervalSeconds: number,
  reason: ReviewScheduleReason,
  policy: ReviewPolicy,
): ReviewSchedule {
  const nextReviewAt = new Date(
    now.getTime() + intervalSeconds * 1_000,
  );
  return Object.freeze({
    policyVersion: policy.version,
    reviewState: deriveReviewState(nextReviewAt, now),
    nextReviewAt,
    intervalSeconds,
    reason,
  });
}
function successfulInterval(
  input: ScheduleReviewInput,
  policy: ReviewPolicy,
): { intervalSeconds: number; reason: ReviewScheduleReason } {
  if (input.assistanceLevel === "answer_exposed") {
    return {
      intervalSeconds: policy.answerExposedIntervalSeconds,
      reason: "assisted_success",
    };
  }
  if (input.assistanceLevel === "hinted") {
    return {
      intervalSeconds: policy.hintedIntervalSeconds,
      reason: "assisted_success",
    };
  }

  const base =
    input.masteryState === "mastered"
      ? policy.independentMasteredIntervalSeconds
      : policy.independentLearningIntervalSeconds;
  const successfulReviewCount = Math.max(
    0,
    Math.floor(input.successfulReviewCount),
  );
  const streakAdjusted =
    base *
    Math.pow(
      policy.streakMultiplier,
      Math.min(successfulReviewCount, 6),
    );
  const spacingAdjusted =
    input.spacingSeconds >= DAY_SECONDS
      ? streakAdjusted * policy.spacedSuccessMultiplier
      : streakAdjusted;
  const previousAdjusted =
    input.previousIntervalSeconds &&
    Number.isFinite(input.previousIntervalSeconds)
      ? Math.max(
          spacingAdjusted,
          input.previousIntervalSeconds * policy.streakMultiplier,
        )
      : spacingAdjusted;

  return {
    intervalSeconds: Math.round(
      Math.min(previousAdjusted, policy.maximumIntervalSeconds),
    ),
    reason: "independent_success",
  };
}

/**
 * Produces review timing only. It never changes mastery: a mastered concept
 * can be scheduled or due, and stale evidence can be due for revalidation.
 */
export function scheduleReview(
  input: ScheduleReviewInput,
  clock: LearningClock,
  policy: ReviewPolicy = DEFAULT_REVIEW_POLICY,
): ReviewSchedule {
  const now = clock.now();
  if (input.freshness === "unsupported") {
    return Object.freeze({
      policyVersion: policy.version,
      reviewState: "unscheduled",
      nextReviewAt: null,
      intervalSeconds: null,
      reason: "unsupported",
    });
  }
  if (input.freshness === "needs_revalidation") {
    return Object.freeze({
      policyVersion: policy.version,
      reviewState: "due",
      nextReviewAt: now,
      intervalSeconds: 0,
      reason: "needs_revalidation",
    });
  }

  if (input.verdict === "incorrect") {
    return scheduleAt(
      now,
      policy.incorrectIntervalSeconds,
      "incorrect",
      policy,
    );
  }
  if (input.verdict === "partial") {
    return scheduleAt(
      now,
      policy.partialIntervalSeconds,
      "partial",
      policy,
    );
  }
  if (input.verdict === "uncertain") {
    return scheduleAt(
      now,
      policy.uncertainIntervalSeconds,
      "uncertain",
      policy,
    );
  }

  const success = successfulInterval(input, policy);
  return scheduleAt(
    now,
    success.intervalSeconds,
    success.reason,
    policy,
  );
}
