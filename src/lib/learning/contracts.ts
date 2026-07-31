/**
 * Stable learning-loop contracts shared by routes, services, workers, and UI.
 *
 * These types intentionally do not import Prisma. Persistence models may grow,
 * while the public API must remain explicit and must never expose grading
 * criteria or provider generation metadata.
 */

export const LEARNING_ERROR_CODES = [
  "learning_disabled",
  "not_found",
  "scope_not_confirmed",
  "source_unsupported",
  "answer_not_available",
  "evaluation_uncertain",
  "idempotency_conflict",
  "invalid_state",
] as const;

export type LearningErrorCode = (typeof LEARNING_ERROR_CODES)[number];

export const LEARNING_GOAL_STATUSES = [
  "active",
  "paused",
  "completed",
  "replaced",
] as const;
export type LearningGoalStatus = (typeof LEARNING_GOAL_STATUSES)[number];

export const LEARNING_SCOPE_STATUSES = ["draft", "confirmed"] as const;
export type LearningScopeStatus = (typeof LEARNING_SCOPE_STATUSES)[number];

export const PRACTICE_MODES = ["evidence_bearing", "feedback_only"] as const;
export type PracticeMode = (typeof PRACTICE_MODES)[number];

export const ASSISTANCE_LEVELS = [
  "independent",
  "hinted",
  "answer_exposed",
] as const;
export type AssistanceLevel = (typeof ASSISTANCE_LEVELS)[number];

export const EVALUATION_VERDICTS = [
  "correct",
  "partial",
  "incorrect",
  "uncertain",
] as const;
export type EvaluationVerdict = (typeof EVALUATION_VERDICTS)[number];

export const MASTERY_STATES = ["new", "learning", "mastered"] as const;
export type MasteryState = (typeof MASTERY_STATES)[number];

export const CONTENT_FRESHNESS_STATES = [
  "current",
  "needs_revalidation",
  "unsupported",
] as const;
export type ContentFreshness = (typeof CONTENT_FRESHNESS_STATES)[number];

export const LEARNING_SESSION_MODES = ["diagnostic", "review"] as const;
export type LearningSessionMode = (typeof LEARNING_SESSION_MODES)[number];

export const LEARNING_SESSION_STATUSES = [
  "draft",
  "ready",
  "in_progress",
  "completed",
  "cancelled",
] as const;
export type LearningSessionStatus = (typeof LEARNING_SESSION_STATUSES)[number];

export type ReviewState = "unscheduled" | "scheduled" | "due";

export interface LearningClock {
  now(): Date;
}

export interface LearningIdGenerator {
  nextId(kind: string): string;
}

export interface LearningModelGateway {
  generateKnowledgeMap(input: unknown): Promise<unknown>;
  generatePracticeItems(input: unknown): Promise<unknown>;
  evaluateAttempt(input: unknown): Promise<unknown>;
}

export const systemLearningClock: LearningClock = {
  now: () => new Date(),
};

export interface PublicSourceAnchorDto {
  id: string;
  fileAssetId: string | null;
  locator: Record<string, unknown>;
  excerptHash: string;
}

export interface PracticeItemOptionDto {
  id: string;
  label: string;
}

export type AnswerCriteriaDto =
  | {
      kind: "single_choice";
      selectedOptionId: string;
    }
  | {
      kind: "multiple_choice";
      requiredOptionIds: string[];
    }
  | {
      kind: "boolean";
      expected: boolean;
    }
  | {
      kind: "numeric";
      expected: number;
      absoluteTolerance: number;
      unit?: string | null;
    }
  | {
      kind: "keywords";
      required: string[];
      optional?: string[];
    }
  | {
      kind: "rubric";
      criteria: Array<{
        label: string;
        description: string;
        weight: number;
      }>;
    };

export interface PracticeItemPublicDto {
  id: string;
  lineageId: string;
  version: number;
  prompt: string;
  type: string;
  options?: readonly PracticeItemOptionDto[] | null;
  mode: PracticeMode;
  freshness: ContentFreshness;
  sourceAnchors: PublicSourceAnchorDto[];
}

export interface PracticeItemPrivateDto extends PracticeItemPublicDto {
  explanation: string | null;
  answerCriteria: AnswerCriteriaDto;
  generationMetadata: Record<string, unknown> | null;
}

export interface PracticeItemFeedbackDto extends PracticeItemPublicDto {
  explanation: string | null;
}

export function toPublicPracticeItem(
  item: PracticeItemPrivateDto
): PracticeItemPublicDto {
  return {
    id: item.id,
    lineageId: item.lineageId,
    version: item.version,
    prompt: item.prompt,
    type: item.type,
    ...(item.options === undefined ? {} : { options: item.options }),
    mode: item.mode,
    freshness: item.freshness,
    sourceAnchors: item.sourceAnchors,
  };
}

export function toPracticeItemFeedback(
  item: PracticeItemPrivateDto
): PracticeItemFeedbackDto {
  return {
    ...toPublicPracticeItem(item),
    explanation: item.explanation,
  };
}

export function deriveReviewState(
  nextReviewAt: Date | null,
  now: Date
): ReviewState {
  if (!nextReviewAt) return "unscheduled";
  return nextReviewAt.getTime() <= now.getTime() ? "due" : "scheduled";
}

export class LearningServiceError extends Error {
  readonly code: LearningErrorCode;
  readonly status: number;

  constructor(code: LearningErrorCode, message: string, status = 400) {
    super(message);
    this.name = "LearningServiceError";
    this.code = code;
    this.status = status;
  }
}
