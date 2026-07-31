/**
 * Wave 2A learning client foundation: shared DTO types, query keys, URL
 * builders, and idempotency helpers for all `use-learning-*` hooks.
 *
 * All shapes mirror the actual learning service responses (type-only imports
 * are erased at compile time, so no server-only code reaches the client
 * bundle). Inline response bodies that the service does not export as named
 * types (today / wrong-answers / reviews / progress envelope) are declared
 * here to match the service implementation exactly.
 *
 * Hard rule: pre-submit data must never carry answerCriteria, explanation, or
 * generationMetadata. `explanation` is only used in post-submit feedback
 * payloads (attempt result / answer exposure / wrong-answer items).
 */

export type {
  AssistanceLevel,
  AnswerExposureResultDto,
  AttemptEvaluationDto,
  AttemptResultDto,
  ContentFreshness,
  EvaluationVerdict,
  HintResultDto,
  ItemFeedbackDto,
  KnowledgeMapDto,
  LearningGoalDto,
  LearningInteractionDto,
  LearningMaterialMode,
  LearningProgressPointDto,
  LearningProgressResponse,
  LearningProgressSummaryDto,
  LearningScopeDto,
  LearningSessionClientDto,
  LearningSessionItemClientDto,
  LearningTodayGoalDto,
  LearningTodayResponse,
  MasteryState,
  PracticeItemClientDto,
  PracticeItemOptionDto,
  PracticeItemPublicDto,
  PracticeOptionDto,
  ReviewEntryDto,
  ReviewListResponse,
  ReviewState,
  TodayNextActionDto,
  TodayNextActionType,
  WrongAnswerAttemptDto,
  WrongAnswerItemDto,
  WrongAnswerListResponse,
} from "@/lib/api/types";

import type { LearningMaterialMode } from "@/lib/api/types";
import { queryKeys } from "@/lib/query-keys";

/* ------------------------------------------------------------------ */
/* Request payload types                                               */
/* ------------------------------------------------------------------ */

/**
 * Deep-link `step` values used by the server's today hrefs
 * (`/projects/<id>/learning?goal=..&step=..`). Distinct vocabulary from
 * `TodayNextActionType` — do not conflate the two.
 */
export const LEARNING_DEEP_LINK_STEPS = [
  "scope",
  "map",
  "diagnostic",
  "review",
] as const;
export type LearningDeepLinkStep = (typeof LEARNING_DEEP_LINK_STEPS)[number];

export type AttemptAnswer =
  | string
  | number
  | boolean
  | Array<string | number | boolean>
  | Record<string, string | number | boolean | string[]>;

export interface CreateGoalInput {
  title: string;
  purpose?: string | null;
  targetDate?: string | null;
  dailyMinutes?: number | null;
  activate?: boolean;
}

export interface SaveScopeDraftInput {
  expectedVersion: number;
  definition: Record<string, unknown>;
  materialMode: LearningMaterialMode;
  fileIds: string[];
  materialGaps: string[];
}

/* ------------------------------------------------------------------ */
/* Query keys                                                        */
/* ------------------------------------------------------------------ */

export const learningKeys = queryKeys.learning;

/* ------------------------------------------------------------------ */
/* URL builders (frozen routes from docs/learning-loop-p0-iteration-plan §7.2) */
/* ------------------------------------------------------------------ */

export const learningUrls = {
  goals: (projectId: string) => `/api/projects/${projectId}/learning/goals`,
  goal: (projectId: string, goalId: string) =>
    `/api/projects/${projectId}/learning/goals/${goalId}`,
  scope: (projectId: string, goalId: string) =>
    `/api/projects/${projectId}/learning/goals/${goalId}/scope`,
  map: (projectId: string, goalId: string) =>
    `/api/projects/${projectId}/learning/goals/${goalId}/map`,
  diagnostics: (projectId: string, goalId: string) =>
    `/api/projects/${projectId}/learning/goals/${goalId}/diagnostics`,
  session: (projectId: string, sessionId: string) =>
    `/api/projects/${projectId}/learning/sessions/${sessionId}`,
  sessionItemHint: (projectId: string, sessionId: string, sessionItemId: string) =>
    `/api/projects/${projectId}/learning/sessions/${sessionId}/items/${sessionItemId}/hint`,
  sessionItemAnswer: (projectId: string, sessionId: string, sessionItemId: string) =>
    `/api/projects/${projectId}/learning/sessions/${sessionId}/items/${sessionItemId}/answer`,
  sessionItemAttempts: (projectId: string, sessionId: string, sessionItemId: string) =>
    `/api/projects/${projectId}/learning/sessions/${sessionId}/items/${sessionItemId}/attempts`,
  reviews: (projectId: string, goalId: string) =>
    `/api/projects/${projectId}/learning/goals/${goalId}/reviews`,
  wrongAnswers: (projectId: string, goalId: string) =>
    `/api/projects/${projectId}/learning/goals/${goalId}/wrong-answers`,
  progress: (projectId: string, goalId: string) =>
    `/api/projects/${projectId}/learning/goals/${goalId}/progress`,
  today: () => `/api/learning/today`,
};

/* ------------------------------------------------------------------ */
/* Idempotency                                                         */
/* ------------------------------------------------------------------ */

/**
 * Stable-per-call-site idempotency key. Callers must create the key once per
 * logical user action and reuse it across retries of that same action.
 */
export function createIdempotencyKey(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  return `learning-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 12)}`;
}
