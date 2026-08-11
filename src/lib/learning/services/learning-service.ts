import "server-only";

import { createHash } from "node:crypto";

import {
  deriveReviewState,
  LEARNING_ERROR_TYPES,
  LearningServiceError,
  type AnswerCriteriaDto,
  type AssistanceLevel,
  type ContentFreshness,
  type EvaluationVerdict,
  type LearningClock,
  type LearningErrorType,
  type LearningIdGenerator,
  type LearningModelGateway,
  type PracticeItemPublicDto,
} from "@/lib/learning/contracts";
import { gradeAttempt } from "@/lib/learning/grading";
import {
  deriveFreshness,
  deriveWrongAnswer,
  projectProgress,
  resolveActiveEvaluation,
  scheduleReview,
  type ProgressEvaluation,
  type WrongAnswerAttempt,
} from "@/lib/learning/policy";
import {
  Prisma,
  type LearningGoalStatus,
  type LearningMaterialMode,
  type PrismaClient,
} from "@/generated/prisma/client";
import type {
  learningGoalCreateSchema,
  learningScopeConfirmSchema,
  learningScopeDraftSchema,
  practiceAttemptSubmissionSchema,
  SourceLocator,
} from "@/lib/learning/validators";
import type {
  errorTypeCorrectionCommandSchema,
  goalRevisionCommandSchema,
  profileResetCommandSchema,
  regradeCommandSchema,
  createStudyPackSchema,
  generateStudyPackSchema,
  publishStudyPackSchema,
  saveStudyPackSectionSchema,
  updateStudyPackOutlineSchema,
} from "@/lib/learning/server/input-schemas";
import {
  answerCriteriaSchema,
  knowledgeMapGenerationSchema,
  practiceItemGenerationSchema,
  sourceAnchorSnapshotSchema,
} from "@/lib/learning/validators";
import { z } from "zod";
import {
  computeEffectiveContentFingerprint,
  getEffectiveFileContent,
} from "@/lib/files/content-fingerprint";
import type { ParseQualityReport } from "@/lib/document-pipeline/quality-checker";
import { gateHighConfidenceGeneration } from "@/lib/document-pipeline/quality-gate";
import { classifyCoverage } from "@/lib/rag/coverage";
import { logger } from "@/lib/logger";

type GoalCreateInput = z.infer<typeof learningGoalCreateSchema>;
type ScopeDraftInput = z.infer<typeof learningScopeDraftSchema>;
type ScopeConfirmInput = z.infer<typeof learningScopeConfirmSchema>;
type AttemptSubmissionInput = z.infer<typeof practiceAttemptSubmissionSchema>;
type ErrorTypeCorrectionInput = z.infer<
  typeof errorTypeCorrectionCommandSchema
>;
type RegradeInput = z.infer<typeof regradeCommandSchema>;
type GoalRevisionInput = z.infer<typeof goalRevisionCommandSchema>;
type ProfileResetInput = z.infer<typeof profileResetCommandSchema>;
type CreateStudyPackInput = z.infer<typeof createStudyPackSchema>;
type UpdateStudyPackOutlineInput = z.infer<
  typeof updateStudyPackOutlineSchema
>;
type GenerateStudyPackInput = z.infer<typeof generateStudyPackSchema>;
type SaveStudyPackSectionInput = z.infer<typeof saveStudyPackSectionSchema>;
type PublishStudyPackInput = z.infer<typeof publishStudyPackSchema>;

export interface IdempotentGenerationInput {
  idempotencyKey: string;
}

export interface GoalStatusInput {
  status: LearningGoalStatus;
  idempotencyKey: string;
}

export interface CreateLearningServiceOptions {
  prisma: PrismaClient;
  clock: LearningClock;
  ids: LearningIdGenerator;
  modelGateway: LearningModelGateway;
}

export interface GoalCommand {
  userId: string;
  projectId: string;
}

export interface LearningGoalDto {
  id: string;
  projectId: string;
  title: string;
  purpose: string | null;
  targetDate: string | null;
  dailyMinutes: number | null;
  status: LearningGoalStatus;
  createdAt: string;
  updatedAt: string;
}

export interface LearningScopeDto {
  id: string;
  goalId: string;
  version: number;
  status: "draft" | "confirmed";
  definition: Record<string, unknown>;
  materialMode: LearningMaterialMode;
  fileIds: string[];
  materialGaps: string[];
  confirmedAt: string | null;
  createdAt: string;
}

export interface KnowledgePointDto {
  id: string;
  lineageId: string;
  stableKey: string;
  name: string;
  kind: string;
  orderIndex: number;
  freshness: "current" | "needs_revalidation" | "unsupported";
  sourceAnchors: Array<{
    id: string;
    fileAssetId: string | null;
    locator: Record<string, unknown>;
    excerptHash: string;
  }>;
}

export interface KnowledgeMapDto {
  id: string;
  goalId: string;
  scopeId: string;
  version: number;
  sourceFingerprint: string;
  createdAt: string;
  points: KnowledgePointDto[];
}

export interface LearningSessionDto {
  id: string;
  goalId: string;
  knowledgeMapId: string;
  mode: "diagnostic" | "review";
  status: "draft" | "ready" | "in_progress" | "completed" | "cancelled";
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  items: Array<{
    id: string;
    orderIndex: number;
    status: "pending" | "in_progress" | "completed" | "skipped";
    practiceItem: PracticeItemPublicDto;
  }>;
}

export interface LearningInteractionDto {
  id: string;
  sessionItemId: string;
  type: "hint_revealed" | "answer_revealed";
  createdAt: string;
}

export interface LearningProgressDto {
  id: string | null;
  lineageId: string;
  knowledgePointId: string;
  name: string;
  masteryState: "new" | "learning" | "mastered";
  historicalMasteryState: "new" | "learning" | "mastered";
  freshness: ContentFreshness;
  nextReviewAt: string | null;
  reviewState: "unscheduled" | "scheduled" | "due";
  policyVersion: string;
  evidenceAsOf: string | null;
}

export interface AttemptSubmissionResult {
  attempt: {
    id: string;
    sessionItemId: string;
    answer: unknown;
    assistanceLevel: AssistanceLevel;
    spacingSeconds: number;
    submittedAt: string;
  };
  evaluation: {
    id: string;
    attemptId: string;
    verdict: EvaluationVerdict;
    score: number | null;
    rubric: Record<string, unknown> | null;
    confidence: number;
    errorType: string | null;
    reason: string;
    policyVersion: string;
    createdAt: string;
  };
  progress: LearningProgressDto[];
  feedback: {
    practiceItem: PracticeItemPublicDto;
    explanation: string | null;
  };
}

export interface LearningErrorTypeCorrectionDto {
  id: string;
  evaluationId: string;
  errorType: LearningErrorType;
  reason: string | null;
  createdAt: string;
}

export interface LearningRegradeDto {
  id: string;
  attemptId: string;
  verdict: EvaluationVerdict;
  score: number | null;
  confidence: number;
  errorType: string | null;
  reason: string;
  policyVersion: string;
  supersedesEvaluationId: string;
  createdAt: string;
}

export interface LearningGoalRevisionDto {
  id: string;
  goalId: string;
  title: string;
  purpose: string | null;
  targetDate: string | null;
  dailyMinutes: number | null;
  reason: string | null;
  createdAt: string;
}

export type LearningProfileResetScope =
  | { kind: "user" }
  | { kind: "goal"; goalId: string }
  | { kind: "point"; goalId: string; lineageId: string };

export interface LearningProfileResetDto {
  id: string;
  scope: LearningProfileResetScope;
  reason: string | null;
  createdAt: string;
  affectedPointCount: number;
}

export type StudyPackOutlineItemDto = {
  key: string;
  title: string;
  description: string | null;
};

export type StudyPackSectionStatus =
  | "draft"
  | "queued"
  | "generating"
  | "ready"
  | "failed"
  | "stale";

export interface StudyPackSectionDto {
  id: string;
  key: string;
  orderIndex: number;
  title: string;
  description: string | null;
  status: StudyPackSectionStatus;
  /** Effective content: the user's edited version when present. */
  content: string | null;
  userEdited: boolean;
  userEditedAt: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StudyPackDto {
  id: string;
  goalId: string;
  title: string;
  outline: StudyPackOutlineItemDto[];
  outlineStatus: "draft" | "confirmed";
  sourceFingerprint: string;
  publishedArtifactId: string | null;
  createdAt: string;
  updatedAt: string;
  sections: StudyPackSectionDto[];
}

export interface LearningHistoryEvaluationDto {
  id: string;
  attemptId: string;
  verdict: EvaluationVerdict;
  score: number | null;
  confidence: number;
  errorType: string | null;
  reason: string;
  policyVersion: string;
  supersedesEvaluationId: string | null;
  createdAt: string;
  corrections: LearningErrorTypeCorrectionDto[];
}

export interface LearningHistoryEvidenceDto {
  attempt: {
    id: string;
    answer: unknown;
    assistanceLevel: AssistanceLevel;
    spacingSeconds: number;
    submittedAt: string;
  };
  session: {
    id: string;
    mode: "diagnostic" | "review";
  };
  practiceItem: {
    id: string;
    lineageId: string;
    prompt: string;
    type: string;
    sourceAnchors: Array<{
      id: string;
      fileAssetId: string | null;
      sourceFileName: string;
      locator: Record<string, unknown>;
    }>;
  };
  evaluations: LearningHistoryEvaluationDto[];
  activeEvaluationId: string | null;
  effectiveErrorType: {
    value: string;
    source: "evaluation" | "user_correction";
    sourceId: string;
  } | null;
  /** True when this evidence predates the latest profile reset boundary. */
  resetBefore: boolean;
}

export interface LearningHistoryPointDto extends LearningProgressDto {
  sourceAnchors: Array<{
    id: string;
    fileAssetId: string | null;
    sourceFileName: string;
    locator: Record<string, unknown>;
  }>;
  evidence: LearningHistoryEvidenceDto[];
  /** Latest profile reset boundary for this point, null when never reset. */
  resetAt: string | null;
}

export interface LearningHistoryDto {
  goal: LearningGoalDto;
  summary: {
    totalPoints: number;
    weakPoints: number;
    dueReviews: number;
    attempts: number;
    manualCorrections: number;
  };
  points: LearningHistoryPointDto[];
}

const mapInclude = {
  knowledgePoints: {
    orderBy: { orderIndex: "asc" as const },
    include: {
      lineage: true,
      sourceLinks: {
        include: { sourceAnchor: true },
      },
    },
  },
} satisfies Prisma.KnowledgeMapInclude;

type MapRecord = Prisma.KnowledgeMapGetPayload<{ include: typeof mapInclude }>;

const sessionInclude = {
  items: {
    orderBy: { orderIndex: "asc" as const },
    include: {
      practiceItem: {
        include: {
          lineage: true,
          sourceLinks: {
            include: { sourceAnchor: true },
          },
        },
      },
    },
  },
} satisfies Prisma.LearningSessionInclude;

type SessionRecord = Prisma.LearningSessionGetPayload<{
  include: typeof sessionInclude;
}>;

const sessionItemPrivateInclude = {
  session: true,
  interactions: {
    orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
  },
  practiceItem: {
    include: {
      lineage: true,
      answerSpec: true,
      sourceLinks: {
        include: { sourceAnchor: true },
      },
      knowledgePoints: {
        include: {
          knowledgePoint: {
            include: { lineage: true },
          },
        },
      },
    },
  },
} satisfies Prisma.LearningSessionItemInclude;

type SessionItemPrivateRecord = Prisma.LearningSessionItemGetPayload<{
  include: typeof sessionItemPrivateInclude;
}>;

const attemptResultInclude = {
  evaluations: {
    orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
  },
  sessionItem: {
    include: sessionItemPrivateInclude,
  },
} satisfies Prisma.PracticeAttemptInclude;

type AttemptResultRecord = Prisma.PracticeAttemptGetPayload<{
  include: typeof attemptResultInclude;
}>;

const historyAttemptInclude = {
  evaluations: {
    orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
    include: {
      errorTypeCorrections: {
        orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
      },
    },
  },
  sessionItem: {
    include: sessionItemPrivateInclude,
  },
} satisfies Prisma.PracticeAttemptInclude;

const studyPackInclude = {
  sections: {
    orderBy: [{ orderIndex: "asc" as const }, { key: "asc" as const }],
  },
} satisfies Prisma.StudyPackInclude;

type StudyPackRecord = Prisma.StudyPackGetPayload<{
  include: typeof studyPackInclude;
}>;

type HistoryAttemptRecord = Prisma.PracticeAttemptGetPayload<{
  include: typeof historyAttemptInclude;
}>;

function wrongAnswerProjectionForHistory(
  itemLineageId: string,
  history: AttemptResultRecord[]
) {
  const attempts: WrongAnswerAttempt[] = history.map((attempt) => ({
    id: attempt.id,
    itemLineageId,
    mode: attempt.sessionItem.practiceItem.mode,
    assistanceLevel: attempt.assistanceLevel,
    spacingSeconds: attempt.spacingSeconds,
    submittedAt: attempt.submittedAt,
  }));
  const evaluations: ProgressEvaluation[] = history.flatMap((attempt) =>
    attempt.evaluations.map((evaluation) => ({
      id: evaluation.id,
      attemptId: evaluation.attemptId,
      supersedesEvaluationId: evaluation.supersedesEvaluationId,
      createdAt: evaluation.createdAt,
      verdict: evaluation.verdict,
      score: evaluation.score,
      rubric: evaluation.rubric ? objectJson(evaluation.rubric) : null,
      confidence: evaluation.confidence,
      errorType: evaluation.errorType,
      reason: evaluation.reason,
    }))
  );
  return deriveWrongAnswer({ itemLineageId, attempts, evaluations });
}

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function objectJson(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringArrayJson(value: Prisma.JsonValue | null): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function practiceOptionsJson(
  value: Prisma.JsonValue | null
): Array<{ id: string; label: string }> | null {
  if (!Array.isArray(value)) return null;
  const options = value.flatMap((option) => {
    if (
      !option ||
      typeof option !== "object" ||
      Array.isArray(option) ||
      typeof option.id !== "string" ||
      typeof option.label !== "string"
    ) {
      return [];
    }
    return [{ id: option.id, label: option.label }];
  });
  return options.length === value.length ? options : null;
}

function toGoalDto(goal: {
  id: string;
  projectId: string;
  title: string;
  purpose: string | null;
  targetDate: Date | null;
  dailyMinutes: number | null;
  status: LearningGoalStatus;
  createdAt: Date;
  updatedAt: Date;
}): LearningGoalDto {
  return {
    id: goal.id,
    projectId: goal.projectId,
    title: goal.title,
    purpose: goal.purpose,
    targetDate: iso(goal.targetDate),
    dailyMinutes: goal.dailyMinutes,
    status: goal.status,
    createdAt: goal.createdAt.toISOString(),
    updatedAt: goal.updatedAt.toISOString(),
  };
}

function toScopeDto(scope: {
  id: string;
  goalId: string;
  version: number;
  status: "draft" | "confirmed";
  definition: Prisma.JsonValue;
  materialMode: LearningMaterialMode;
  fileIds: string[];
  materialGaps: Prisma.JsonValue | null;
  confirmedAt: Date | null;
  createdAt: Date;
}): LearningScopeDto {
  return {
    id: scope.id,
    goalId: scope.goalId,
    version: scope.version,
    status: scope.status,
    definition: objectJson(scope.definition),
    materialMode: scope.materialMode,
    fileIds: [...scope.fileIds],
    materialGaps: stringArrayJson(scope.materialGaps),
    confirmedAt: iso(scope.confirmedAt),
    createdAt: scope.createdAt.toISOString(),
  };
}

function toMapDto(map: MapRecord): KnowledgeMapDto {
  return {
    id: map.id,
    goalId: map.goalId,
    scopeId: map.scopeId,
    version: map.version,
    sourceFingerprint: map.sourceFingerprint,
    createdAt: map.createdAt.toISOString(),
    points: map.knowledgePoints.map((point) => ({
      id: point.id,
      lineageId: point.lineageId,
      stableKey: point.lineage.stableKey,
      name: point.name,
      kind: point.kind,
      orderIndex: point.orderIndex,
      freshness: point.freshness,
      sourceAnchors: point.sourceLinks.map(({ sourceAnchor }) => ({
        id: sourceAnchor.id,
        fileAssetId: sourceAnchor.fileAssetId,
        locator: objectJson(sourceAnchor.locator),
        excerptHash: sourceAnchor.excerptHash,
      })),
    })),
  };
}

function toPublicPracticeItemDto(item: {
  id: string;
  lineageId: string;
  version: number;
  prompt: string;
  type: string;
  options: Prisma.JsonValue | null;
  mode: "evidence_bearing" | "feedback_only";
  freshness: ContentFreshness;
  sourceLinks: Array<{
    sourceAnchor: {
      id: string;
      fileAssetId: string | null;
      locator: Prisma.JsonValue;
      excerptHash: string;
    };
  }>;
}): PracticeItemPublicDto {
  return {
    id: item.id,
    lineageId: item.lineageId,
    version: item.version,
    prompt: item.prompt,
    type: item.type,
    options: practiceOptionsJson(item.options),
    mode: item.mode,
    freshness: item.freshness,
    sourceAnchors: item.sourceLinks.map(({ sourceAnchor }) => ({
      id: sourceAnchor.id,
      fileAssetId: sourceAnchor.fileAssetId,
      locator: objectJson(sourceAnchor.locator),
      excerptHash: sourceAnchor.excerptHash,
    })),
  };
}

function toSessionDto(session: SessionRecord): LearningSessionDto {
  return {
    id: session.id,
    goalId: session.goalId,
    knowledgeMapId: session.knowledgeMapId,
    mode: session.mode,
    status: session.status,
    startedAt: iso(session.startedAt),
    completedAt: iso(session.completedAt),
    createdAt: session.createdAt.toISOString(),
    items: session.items.map((sessionItem) => {
      const item = sessionItem.practiceItem;
      return {
        id: sessionItem.id,
        orderIndex: sessionItem.orderIndex,
        status: sessionItem.status,
        practiceItem: toPublicPracticeItemDto(item),
      };
    }),
  };
}

function toInteractionDto(interaction: {
  id: string;
  sessionItemId: string;
  type: "hint_revealed" | "answer_revealed";
  createdAt: Date;
}): LearningInteractionDto {
  return {
    id: interaction.id,
    sessionItemId: interaction.sessionItemId,
    type: interaction.type,
    createdAt: interaction.createdAt.toISOString(),
  };
}

function toEvaluationDto(
  evaluation: AttemptResultRecord["evaluations"][number]
): AttemptSubmissionResult["evaluation"] {
  return {
    id: evaluation.id,
    attemptId: evaluation.attemptId,
    verdict: evaluation.verdict,
    score: evaluation.score,
    rubric: evaluation.rubric
      ? objectJson(evaluation.rubric)
      : null,
    confidence: evaluation.confidence,
    errorType: evaluation.errorType,
    reason: evaluation.reason,
    policyVersion: evaluation.policyVersion,
    createdAt: evaluation.createdAt.toISOString(),
  };
}

function toErrorTypeCorrectionDto(correction: {
  id: string;
  evaluationId: string;
  errorType: string;
  reason: string | null;
  createdAt: Date;
}): LearningErrorTypeCorrectionDto {
  if (!LEARNING_ERROR_TYPES.includes(correction.errorType as LearningErrorType)) {
    throw new LearningServiceError(
      "invalid_state",
      "学习错因记录包含不支持的类型",
      500
    );
  }
  return {
    id: correction.id,
    evaluationId: correction.evaluationId,
    errorType: correction.errorType as LearningErrorType,
    reason: correction.reason,
    createdAt: correction.createdAt.toISOString(),
  };
}

function toGoalRevisionDto(revision: {
  id: string;
  goalId: string;
  title: string;
  purpose: string | null;
  targetDate: Date | null;
  dailyMinutes: number | null;
  reason: string | null;
  createdAt: Date;
}): LearningGoalRevisionDto {
  return {
    id: revision.id,
    goalId: revision.goalId,
    title: revision.title,
    purpose: revision.purpose,
    targetDate: iso(revision.targetDate),
    dailyMinutes: revision.dailyMinutes,
    reason: revision.reason,
    createdAt: revision.createdAt.toISOString(),
  };
}

function toRegradeDto(regrade: {
  id: string;
  attemptId: string;
  verdict: string;
  score: number | null;
  confidence: number;
  errorType: string | null;
  reason: string;
  policyVersion: string;
  supersedesEvaluationId: string | null;
  createdAt: Date;
}): LearningRegradeDto {
  if (regrade.supersedesEvaluationId === null) {
    throw new LearningServiceError(
      "invalid_state",
      "判定纠正记录缺少被纠正的判定",
      500
    );
  }
  return {
    id: regrade.id,
    attemptId: regrade.attemptId,
    verdict: regrade.verdict as EvaluationVerdict,
    score: regrade.score,
    confidence: regrade.confidence,
    errorType: regrade.errorType,
    reason: regrade.reason,
    policyVersion: regrade.policyVersion,
    supersedesEvaluationId: regrade.supersedesEvaluationId,
    createdAt: regrade.createdAt.toISOString(),
  };
}

function toProfileResetDto(
  reset: {
    id: string;
    goalId: string | null;
    lineageId: string | null;
    reason: string | null;
    createdAt: Date;
  },
  affectedPointCount: number
): LearningProfileResetDto {
  const scope: LearningProfileResetScope =
    reset.goalId !== null && reset.lineageId !== null
      ? { kind: "point", goalId: reset.goalId, lineageId: reset.lineageId }
      : reset.goalId !== null
        ? { kind: "goal", goalId: reset.goalId }
        : { kind: "user" };
  return {
    id: reset.id,
    scope,
    reason: reset.reason,
    createdAt: reset.createdAt.toISOString(),
    affectedPointCount,
  };
}

function toStudyPackSectionDto(
  section: StudyPackRecord["sections"][number]
): StudyPackSectionDto {
  const userEdited = section.userEditedContent !== null;
  return {
    id: section.id,
    key: section.key,
    orderIndex: section.orderIndex,
    title: section.title,
    description: section.description,
    status: section.status,
    content: userEdited ? section.userEditedContent : section.content,
    userEdited,
    userEditedAt: iso(section.userEditedAt),
    failureReason: section.failureReason,
    createdAt: section.createdAt.toISOString(),
    updatedAt: section.updatedAt.toISOString(),
  };
}

function toStudyPackDto(pack: StudyPackRecord): StudyPackDto {
  return {
    id: pack.id,
    goalId: pack.goalId,
    title: pack.title,
    outline: pack.outline as unknown as StudyPackOutlineItemDto[],
    outlineStatus: pack.outlineStatus,
    sourceFingerprint: pack.sourceFingerprint,
    publishedArtifactId: pack.publishedArtifactId,
    createdAt: pack.createdAt.toISOString(),
    updatedAt: pack.updatedAt.toISOString(),
    sections: pack.sections.map(toStudyPackSectionDto),
  };
}

function historyProjectionForAttempt(attempt: HistoryAttemptRecord): {
  activeEvaluationId: string | null;
  effectiveErrorType: LearningHistoryEvidenceDto["effectiveErrorType"];
} {
  const evaluations: ProgressEvaluation[] = attempt.evaluations.map(
    (evaluation) => ({
      id: evaluation.id,
      attemptId: evaluation.attemptId,
      supersedesEvaluationId: evaluation.supersedesEvaluationId,
      createdAt: evaluation.createdAt,
      verdict: evaluation.verdict,
      score: evaluation.score,
      rubric: evaluation.rubric ? objectJson(evaluation.rubric) : null,
      confidence: evaluation.confidence,
      errorType: evaluation.errorType,
      reason: evaluation.reason,
    })
  );
  const resolution = resolveActiveEvaluation(attempt.id, evaluations);
  if (resolution.status !== "active") {
    return { activeEvaluationId: null, effectiveErrorType: null };
  }

  const active = resolution.evaluation;
  const activeEvaluationRecord = attempt.evaluations.find(
    (evaluation) => evaluation.id === active.id
  );
  const latestCorrection = (activeEvaluationRecord?.errorTypeCorrections ?? [])
    .reduce<
      HistoryAttemptRecord["evaluations"][number]["errorTypeCorrections"][number] | null
    >((latest, correction) => {
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

  if (latestCorrection) {
    return {
      activeEvaluationId: active.id,
      effectiveErrorType: {
        value: latestCorrection.errorType,
        source: "user_correction",
        sourceId: latestCorrection.id,
      },
    };
  }
  return {
    activeEvaluationId: active.id,
    effectiveErrorType: active.errorType
      ? {
          value: active.errorType,
          source: "evaluation",
          sourceId: active.id,
        }
      : null,
  };
}

function toHistoryEvidenceDto(
  attempt: HistoryAttemptRecord
): Omit<LearningHistoryEvidenceDto, "resetBefore"> {
  const projection = historyProjectionForAttempt(attempt);
  const practiceItem = attempt.sessionItem.practiceItem;
  return {
    attempt: {
      id: attempt.id,
      answer: attempt.answer,
      assistanceLevel: attempt.assistanceLevel,
      spacingSeconds: attempt.spacingSeconds,
      submittedAt: attempt.submittedAt.toISOString(),
    },
    session: {
      id: attempt.sessionItem.session.id,
      mode: attempt.sessionItem.session.mode,
    },
    practiceItem: {
      id: practiceItem.id,
      lineageId: practiceItem.lineageId,
      prompt: practiceItem.prompt,
      type: practiceItem.type,
      sourceAnchors: practiceItem.sourceLinks.map(({ sourceAnchor }) => ({
        id: sourceAnchor.id,
        fileAssetId: sourceAnchor.fileAssetId,
        sourceFileName: sourceAnchor.sourceFileName,
        locator: objectJson(sourceAnchor.locator),
      })),
    },
    evaluations: attempt.evaluations.map((evaluation) => ({
      id: evaluation.id,
      attemptId: evaluation.attemptId,
      verdict: evaluation.verdict,
      score: evaluation.score,
      confidence: evaluation.confidence,
      errorType: evaluation.errorType,
      reason: evaluation.reason,
      policyVersion: evaluation.policyVersion,
      supersedesEvaluationId: evaluation.supersedesEvaluationId,
      createdAt: evaluation.createdAt.toISOString(),
      corrections: evaluation.errorTypeCorrections.map(
        toErrorTypeCorrectionDto
      ),
    })),
    ...projection,
  };
}

function effectiveMasteryState(
  historical: "new" | "learning" | "mastered",
  freshness: ContentFreshness
): "new" | "learning" | "mastered" {
  if (freshness === "current" || historical === "new") return historical;
  return "learning";
}

function sameGoalInput(
  goal: {
    title: string;
    purpose: string | null;
    targetDate: Date | null;
    dailyMinutes: number | null;
  },
  input: GoalCreateInput
) {
  return (
    goal.title === input.title &&
    goal.purpose === (input.purpose ?? null) &&
    iso(goal.targetDate) === (input.targetDate ?? null) &&
    goal.dailyMinutes === (input.dailyMinutes ?? null)
  );
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

/**
 * Resolve a file's content fingerprint. Files parsed before the
 * contentFingerprint column was introduced keep a NULL column, so fall back
 * to a deterministic on-the-fly computation over the effective content (the
 * enhanced text when enhancementStatus is enhanced, otherwise textContent),
 * using the same NFC / CRLF / trailing-whitespace / trim normalization as
 * parse-job writes. The computed value is stable, so anchors created from it
 * match later writes and downstream source-freshness checks.
 */
export function resolveFileFingerprint(file: {
  textContent: string | null | undefined;
  enhancedContent: string | null | undefined;
  enhancementStatus: string | null | undefined;
  contentFingerprint: string | null;
}): string | null {
  if (file.contentFingerprint) return file.contentFingerprint;
  return computeEffectiveContentFingerprint(file);
}

function sameScopeInput(
  scope: {
    definition: Prisma.JsonValue;
    materialMode: LearningMaterialMode;
    fileIds: string[];
    materialGaps: Prisma.JsonValue | null;
  },
  input: ScopeDraftInput
) {
  return (
    stableJson(scope.definition) === stableJson(input.definition) &&
    scope.materialMode === input.materialMode &&
    stableJson(scope.fileIds) === stableJson(input.fileIds) &&
    stableJson(stringArrayJson(scope.materialGaps)) ===
      stableJson(input.materialGaps)
  );
}

export function createLearningService(options: CreateLearningServiceOptions) {
  const { prisma, clock, ids, modelGateway } = options;

  async function requireProject(userId: string, projectId: string) {
    const project = await prisma.project.findFirst({
      where: { id: projectId, userId },
      select: { id: true },
    });
    if (!project) {
      throw new LearningServiceError("not_found", "学习项目不存在", 404);
    }
    return project;
  }

  async function requireGoal(userId: string, projectId: string, goalId: string) {
    await requireProject(userId, projectId);
    const goal = await prisma.learningGoal.findFirst({
      where: { id: goalId, userId, projectId },
    });
    if (!goal) {
      throw new LearningServiceError("not_found", "学习目标不存在", 404);
    }
    return goal;
  }

  async function requireStudyPack(
    userId: string,
    projectId: string,
    packId: string
  ): Promise<StudyPackRecord> {
    await requireProject(userId, projectId);
    const pack = await prisma.studyPack.findFirst({
      where: {
        id: packId,
        userId,
        goal: { is: { projectId } },
      },
      include: studyPackInclude,
    });
    if (!pack) {
      throw new LearningServiceError(
        "not_found",
        "学习资料包不存在",
        404
      );
    }
    return pack;
  }

  async function requireStudyPackSection(
    pack: StudyPackRecord,
    sectionId: string
  ): Promise<StudyPackRecord["sections"][number]> {
    const section = pack.sections.find(
      (candidate) => candidate.id === sectionId
    );
    if (!section) {
      throw new LearningServiceError(
        "not_found",
        "资料包章节不存在",
        404
      );
    }
    return section;
  }

  async function buildStudyPackSources(command: {
    userId: string;
    projectId: string;
    map: MapRecord;
  }) {
    const anchors = new Map<
      string,
      MapRecord["knowledgePoints"][number]["sourceLinks"][number]["sourceAnchor"]
    >();
    for (const point of command.map.knowledgePoints) {
      for (const link of point.sourceLinks) {
        anchors.set(link.sourceAnchor.anchorKey, link.sourceAnchor);
      }
    }
    const anchorRecords = [...anchors.values()];
    const sourceFiles = await prisma.fileAsset.findMany({
      where: {
        id: {
          in: anchorRecords.flatMap((anchor) =>
            anchor.fileAssetId ? [anchor.fileAssetId] : []
          ),
        },
        userId: command.userId,
        projectId: command.projectId,
      },
      select: {
        id: true,
        textContent: true,
        enhancedContent: true,
        enhancementStatus: true,
        contentFingerprint: true,
        processingMetadata: true,
      },
    });
    const sourceFileById = new Map(
      sourceFiles.map((file) => [file.id, file])
    );
    const sources = anchorRecords.map((anchor) => {
      const file = anchor.fileAssetId
        ? sourceFileById.get(anchor.fileAssetId)
        : undefined;
      const content = file ? getEffectiveFileContent(file) : "";
      if (
        !file ||
        !content.trim() ||
        resolveFileFingerprint(file) !== anchor.contentFingerprint
      ) {
        throw new LearningServiceError(
          "source_unsupported",
          "知识点来源已变化，请先重新生成知识点地图",
          409
        );
      }
      const processingMetadata = file.processingMetadata
        ? objectJson(file.processingMetadata)
        : null;
      return {
        handle: anchor.anchorKey,
        fileAssetId: anchor.fileAssetId,
        title: anchor.sourceFileName,
        content,
        contentFingerprint: anchor.contentFingerprint,
        parseReport: processingMetadata?.parseReport,
      };
    });
    if (sources.length === 0) {
      throw new LearningServiceError(
        "source_unsupported",
        "资料包缺少可引用的学习资料",
        409
      );
    }
    gateSourceQuality(sources);
    return { anchors, sources };
  }

  async function generateStudyPackSectionContent(command: {
    userId: string;
    goalId: string;
    map: MapRecord;
    section: {
      key: string;
      title: string;
      description: string | null;
    };
    sources: Array<{
      handle: string;
      fileAssetId: string | null;
      title: string;
      content: string;
      contentFingerprint: string;
    }>;
  }): Promise<{ content: string; metadata: Record<string, unknown> }> {
    const parsed = z
      .object({
        content: z.string().trim().min(1).max(200_000),
      })
      .strict()
      .parse(
        await modelGateway.generateStudyPackSection({
          userId: command.userId,
          map: toMapDto(command.map),
          section: {
            key: command.section.key,
            title: command.section.title,
            description: command.section.description,
          },
          sources: command.sources,
        })
      );
    return {
      content: parsed.content,
      metadata: { model: "deepseek-v4-flash" },
    };
  }

  async function requireConfirmedScope(goalId: string) {
    const scope = await prisma.learningScope.findFirst({
      where: { goalId },
      orderBy: [{ version: "desc" }, { id: "desc" }],
    });
    if (!scope || scope.status !== "confirmed") {
      throw new LearningServiceError(
        "scope_not_confirmed",
        "请先确认学习范围",
        409
      );
    }
    return scope;
  }

  /**
   * P1-C gate: reject high-confidence generation when any source file's parse
   * report signals low quality (text coverage, failed images, warnings).
   * Files without a report (legacy parses) pass — the gate only applies to
   * parses that produced one.
   */
  function gateSourceQuality(
    sources: Array<{ title: string; parseReport?: unknown }>
  ): void {
    const failures = sources.flatMap((source) => {
      const decision = gateHighConfidenceGeneration(
        source.parseReport as ParseQualityReport | null | undefined
      );
      return decision.allowed ? [] : [`${source.title}（${decision.reason}）`];
    });
    if (failures.length > 0) {
      throw new LearningServiceError(
        "source_unsupported",
        `部分资料解析质量不足，无法生成高置信度内容，请重新解析后重试：${failures.join("；")}`,
        409
      );
    }
  }

  /**
   * Resolve the first block-annotated DocumentChunk per file so source anchors
   * can point at a precise block instead of the whole file. Chunks are rebuilt
   * on every parse, so matching is by fileAssetId (the current parse) — stale
   * anchors are already rejected upstream by contentFingerprint checks, and
   * files without block metadata (plain text, missing chunks) simply fall back
   * to a file-level locator.
   */
  async function resolveBlockLocators(
    fileIds: string[]
  ): Promise<Map<string, { documentChunkId: string; locator: SourceLocator }>> {
    const byFile = new Map<
      string,
      { documentChunkId: string; locator: SourceLocator }
    >();
    if (fileIds.length === 0) return byFile;
    const chunks = await prisma.documentChunk.findMany({
      where: { fileAssetId: { in: fileIds } },
      select: {
        id: true,
        fileAssetId: true,
        chunkIndex: true,
        metadata: true,
      },
      orderBy: [{ chunkIndex: "asc" }, { id: "asc" }],
    });
    for (const chunk of chunks) {
      if (!chunk.fileAssetId || byFile.has(chunk.fileAssetId)) continue;
      const metadata = chunk.metadata ? objectJson(chunk.metadata) : null;
      const blockId = metadata?.blockId;
      if (typeof blockId !== "string" || !blockId.trim()) continue;
      const pageNumber = metadata?.pageNumber;
      byFile.set(chunk.fileAssetId, {
        documentChunkId: chunk.id,
        locator: {
          kind: "block",
          blockId: blockId.trim(),
          ...(typeof pageNumber === "number" && Number.isFinite(pageNumber)
            ? { pageNumber }
            : {}),
        },
      });
    }
    return byFile;
  }

  async function buildSourceSnapshots(command: {
    userId: string;
    projectId: string;
    scope: {
      materialMode: LearningMaterialMode;
      fileIds: string[];
    };
  }) {
    const selectedOnly = command.scope.materialMode === "selected_files";
    const files = await prisma.fileAsset.findMany({
      where: {
        userId: command.userId,
        projectId: command.projectId,
        status: { in: ["parsed", "partial"] },
        ...(selectedOnly ? { id: { in: command.scope.fileIds } } : {}),
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        originalName: true,
        textContent: true,
        enhancedContent: true,
        enhancementStatus: true,
        contentFingerprint: true,
        processingMetadata: true,
      },
    });
    if (
      files.length === 0 ||
      (selectedOnly && files.length !== new Set(command.scope.fileIds).size)
    ) {
      throw new LearningServiceError(
        "source_unsupported",
        "确认范围内没有完整可读的资料",
        409
      );
    }

    const blockLocators = await resolveBlockLocators(
      files.map((file) => file.id)
    );
    const fingerprintBackfills: Array<Promise<void>> = [];
    const snapshots = files.map((file) => {
      const content =
        file.enhancementStatus === "enhanced" && file.enhancedContent
          ? file.enhancedContent
          : file.textContent ?? "";
      const contentFingerprint = resolveFileFingerprint(file);
      if (!content.trim() || !contentFingerprint) {
        throw new LearningServiceError(
          "source_unsupported",
          `资料 ${file.originalName} 缺少可验证的正文指纹`,
          409
        );
      }
      // Legacy rows (uploaded before the contentFingerprint column existed)
      // backfill lazily: keep going even when the write fails, since the
      // fingerprint was already derived deterministically from the content.
      if (contentFingerprint !== file.contentFingerprint) {
        fingerprintBackfills.push(
          prisma.fileAsset
            .update({
              where: { id: file.id },
              data: { contentFingerprint },
            })
            .then(() => undefined)
            .catch((error) => {
              logger.warn("生成知识点地图时回填资料指纹失败", {
                fileId: file.id,
                error:
                  error instanceof Error ? error.message : String(error),
              });
            })
        );
      }
      const handle = sha256(
        `${command.projectId}\n${file.id}\n${contentFingerprint}`
      );
      const block = blockLocators.get(file.id);
      const snapshot = sourceAnchorSnapshotSchema.parse({
        projectId: command.projectId,
        anchorKey: handle,
        fileAssetId: file.id,
        sourceFileName: file.originalName,
        documentChunkId: block?.documentChunkId ?? null,
        locator: block?.locator ?? { kind: "file" },
        contentFingerprint,
        excerptHash: sha256(content),
      });
      const processingMetadata = file.processingMetadata
        ? objectJson(file.processingMetadata)
        : null;
      return {
        ...snapshot,
        handle,
        title: file.originalName,
        content,
        parseReport: processingMetadata?.parseReport,
      };
    });
    await Promise.all(fingerprintBackfills);
    return snapshots;
  }

  async function requireSessionItem(command: {
    userId: string;
    projectId: string;
    sessionId: string;
    sessionItemId: string;
  }): Promise<SessionItemPrivateRecord> {
    await requireProject(command.userId, command.projectId);
    const sessionItem = await prisma.learningSessionItem.findFirst({
      where: {
        id: command.sessionItemId,
        sessionId: command.sessionId,
        session: {
          is: {
            userId: command.userId,
            goal: {
              is: { projectId: command.projectId },
            },
          },
        },
      },
      include: sessionItemPrivateInclude,
    });
    if (!sessionItem) {
      throw new LearningServiceError(
        "not_found",
        "学习会话题目不存在",
        404
      );
    }
    return sessionItem;
  }

  async function markSessionStarted(
    sessionItem: SessionItemPrivateRecord
  ): Promise<void> {
    if (
      sessionItem.session.status !== "draft" &&
      sessionItem.session.status !== "ready"
    ) {
      return;
    }
    await prisma.learningSession.updateMany({
      where: {
        id: sessionItem.sessionId,
        status: { in: ["draft", "ready"] },
      },
      data: {
        status: "in_progress",
        startedAt: sessionItem.session.startedAt ?? clock.now(),
      },
    });
  }

  async function recordInteraction(
    command: {
      userId: string;
      projectId: string;
      sessionId: string;
      sessionItemId: string;
      input: IdempotentGenerationInput;
    },
    type: "hint_revealed" | "answer_revealed"
  ) {
    const sessionItem = await requireSessionItem(command);
    const existing = await prisma.practiceInteractionEvent.findUnique({
      where: {
        sessionItemId_idempotencyKey: {
          sessionItemId: command.sessionItemId,
          idempotencyKey: command.input.idempotencyKey,
        },
      },
    });
    if (existing) {
      if (existing.type !== type) {
        throw new LearningServiceError(
          "idempotency_conflict",
          "该幂等键已用于不同的题目交互",
          409
        );
      }
      return { sessionItem, interaction: existing };
    }

    if (type === "answer_revealed" && sessionItem.session.mode === "diagnostic") {
      const submitted = await prisma.practiceAttempt.count({
        where: {
          userId: command.userId,
          sessionItemId: command.sessionItemId,
        },
      });
      if (submitted === 0) {
        throw new LearningServiceError(
          "answer_not_available",
          "诊断题提交后才能查看答案",
          409
        );
      }
    }

    try {
      const interaction = await prisma.practiceInteractionEvent.create({
        data: {
          id: ids.nextId("practice-interaction"),
          sessionItemId: command.sessionItemId,
          type,
          idempotencyKey: command.input.idempotencyKey,
        },
      });
      await markSessionStarted(sessionItem);
      return { sessionItem, interaction };
    } catch (error) {
      const raced = await prisma.practiceInteractionEvent.findUnique({
        where: {
          sessionItemId_idempotencyKey: {
            sessionItemId: command.sessionItemId,
            idempotencyKey: command.input.idempotencyKey,
          },
        },
      });
      if (raced?.type === type) {
        return { sessionItem, interaction: raced };
      }
      throw error;
    }
  }

  function privateItemFeedback(
    item: SessionItemPrivateRecord["practiceItem"]
  ) {
    return {
      practiceItem: toPublicPracticeItemDto(item),
      explanation: item.answerSpec?.explanation ?? null,
    };
  }

  async function latestPointForLineage(
    goalId: string,
    lineageId: string
  ) {
    return prisma.knowledgePoint.findFirst({
      where: {
        lineageId,
        knowledgeMap: {
          is: { goalId },
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
  }

  /**
   * Latest profile reset boundary affecting this (user, goal, lineage) triple.
   * User-scoped resets (goalId null) apply to every goal; goal-scoped resets
   * (lineageId null) apply to every point of that goal; point-scoped resets
   * apply only to that lineage. Evidence predating the boundary never reaches
   * current mastery, review, wrong-answer, or recommendation projections.
   */
  async function resolveProfileResetCutoff(
    userId: string,
    goalId: string,
    lineageId: string
  ): Promise<Date | null> {
    const resets = await prisma.learningProfileReset.findMany({
      where: {
        userId,
        OR: [
          { goalId: null, lineageId: null },
          { goalId, lineageId: null },
          { goalId, lineageId },
        ],
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { createdAt: true },
    });
    return resets[0]?.createdAt ?? null;
  }

  function lineageAttemptsFilter(
    userId: string,
    goalId: string,
    lineageId: string,
    cutoff: Date | null
  ): Prisma.PracticeAttemptWhereInput {
    return {
      userId,
      ...(cutoff === null ? {} : { submittedAt: { gt: cutoff } }),
      sessionItem: {
        is: {
          practiceItem: {
            is: {
              goalId,
              knowledgePoints: {
                some: {
                  knowledgePoint: {
                    is: { lineageId },
                  },
                },
              },
            },
          },
        },
      },
    };
  }

  function toProgressEvaluation(evaluation: {
    id: string;
    attemptId: string;
    supersedesEvaluationId: string | null;
    createdAt: Date;
    verdict: string;
    score: number | null;
    rubric: Prisma.JsonValue | null;
    confidence: number;
    errorType: string | null;
    reason: string;
  }): ProgressEvaluation {
    return {
      id: evaluation.id,
      attemptId: evaluation.attemptId,
      supersedesEvaluationId: evaluation.supersedesEvaluationId,
      createdAt: evaluation.createdAt,
      verdict: evaluation.verdict as EvaluationVerdict,
      score: evaluation.score,
      rubric: evaluation.rubric ? objectJson(evaluation.rubric) : null,
      confidence: evaluation.confidence,
      errorType: evaluation.errorType,
      reason: evaluation.reason,
    };
  }

  /** Latest reset boundary per lineage, applying user > goal > point scopes. */
  async function resolveCutoffsByLineage(
    userId: string,
    goalId: string,
    lineageIds: readonly string[]
  ): Promise<Map<string, Date>> {
    const resets = await prisma.learningProfileReset.findMany({
      where: {
        userId,
        OR: [
          { goalId: null, lineageId: null },
          { goalId, lineageId: null },
          { goalId, lineageId: { in: [...lineageIds] } },
        ],
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { lineageId: true, createdAt: true },
    });
    const cutoffs = new Map<string, Date>();
    for (const reset of resets) {
      if (reset.lineageId !== null) {
        cutoffs.set(reset.lineageId, reset.createdAt);
        continue;
      }
      for (const lineageId of lineageIds) {
        const existing = cutoffs.get(lineageId);
        if (existing === undefined || reset.createdAt > existing) {
          cutoffs.set(lineageId, reset.createdAt);
        }
      }
    }
    return cutoffs;
  }

  async function toProgressDto(command: {
    userId: string;
    goalId: string;
    lineageId: string;
    point: {
      id: string;
      name: string;
      freshness: ContentFreshness;
    };
  }): Promise<LearningProgressDto> {
    const progress = await prisma.knowledgePointProgress.findUnique({
      where: {
        userId_goalId_lineageId: {
          userId: command.userId,
          goalId: command.goalId,
          lineageId: command.lineageId,
        },
      },
    });
    const historicalMasteryState = progress?.masteryState ?? "new";
    const nextReviewAt =
      command.point.freshness === "unsupported"
        ? null
        : progress?.nextReviewAt ?? null;
    return {
      id: progress?.id ?? null,
      lineageId: command.lineageId,
      knowledgePointId: command.point.id,
      name: command.point.name,
      masteryState: effectiveMasteryState(
        historicalMasteryState,
        command.point.freshness
      ),
      historicalMasteryState,
      freshness: command.point.freshness,
      nextReviewAt: iso(nextReviewAt),
      reviewState: deriveReviewState(nextReviewAt, clock.now()),
      policyVersion: progress?.policyVersion ?? "progress-v1",
      evidenceAsOf: iso(progress?.evidenceAsOf ?? null),
    };
  }

  async function projectLineageProgress(command: {
    userId: string;
    goalId: string;
    lineageId: string;
    latestAttempt: {
      mode: "evidence_bearing" | "feedback_only";
      assistanceLevel: AssistanceLevel;
      spacingSeconds: number;
    };
    latestEvaluation: {
      verdict: EvaluationVerdict;
    };
  }): Promise<LearningProgressDto> {
    const point = await latestPointForLineage(
      command.goalId,
      command.lineageId
    );
    if (!point) {
      throw new LearningServiceError(
        "invalid_state",
        "题目关联的知识点版本不存在",
        409
      );
    }

    const resetCutoff = await resolveProfileResetCutoff(
      command.userId,
      command.goalId,
      command.lineageId
    );
    const attempts = await prisma.practiceAttempt.findMany({
      where: lineageAttemptsFilter(
        command.userId,
        command.goalId,
        command.lineageId,
        resetCutoff
      ),
      orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
      include: {
        sessionItem: {
          select: {
            practiceItem: {
              select: {
                mode: true,
                freshness: true,
              },
            },
          },
        },
        evaluations: {
          include: {
            errorTypeCorrections: true,
          },
        },
      },
    });
    const currentAttempts = attempts.filter(
      (attempt) =>
        attempt.sessionItem.practiceItem.freshness === "current"
    );
    const projectionAttempts = currentAttempts.map((attempt) => ({
      id: attempt.id,
      mode: attempt.sessionItem.practiceItem.mode,
      assistanceLevel: attempt.assistanceLevel,
      spacingSeconds: attempt.spacingSeconds,
      submittedAt: attempt.submittedAt,
    }));
    const projectionEvaluations: ProgressEvaluation[] = currentAttempts.flatMap(
      (attempt) =>
        attempt.evaluations.map((evaluation) => ({
          id: evaluation.id,
          attemptId: evaluation.attemptId,
          supersedesEvaluationId: evaluation.supersedesEvaluationId,
          createdAt: evaluation.createdAt,
          verdict: evaluation.verdict,
          score: evaluation.score,
          rubric: evaluation.rubric
            ? objectJson(evaluation.rubric)
            : null,
          confidence: evaluation.confidence,
          errorType: evaluation.errorType,
          reason: evaluation.reason,
        }))
    );
    const corrections = currentAttempts.flatMap((attempt) =>
      attempt.evaluations.flatMap((evaluation) =>
        evaluation.errorTypeCorrections.map((correction) => ({
          id: correction.id,
          attemptId: attempt.id,
          errorType: correction.errorType,
          createdAt: correction.createdAt,
        }))
      )
    );
    const projection = projectProgress({
      attempts: projectionAttempts,
      evaluations: projectionEvaluations,
      errorTypeCorrections: corrections,
    });
    const previous = await prisma.knowledgePointProgress.findUnique({
      where: {
        userId_goalId_lineageId: {
          userId: command.userId,
          goalId: command.goalId,
          lineageId: command.lineageId,
        },
      },
    });
    const schedule =
      command.latestAttempt.mode === "feedback_only"
        ? {
            nextReviewAt: previous?.nextReviewAt ?? null,
          }
        : scheduleReview(
            {
              masteryState: projection.masteryState,
              verdict: command.latestEvaluation.verdict,
              assistanceLevel: command.latestAttempt.assistanceLevel,
              spacingSeconds: command.latestAttempt.spacingSeconds,
              freshness: point.freshness,
              successfulReviewCount: projection.correctAttemptCount,
              previousIntervalSeconds: null,
            },
            clock
          );
    await prisma.knowledgePointProgress.upsert({
      where: {
        userId_goalId_lineageId: {
          userId: command.userId,
          goalId: command.goalId,
          lineageId: command.lineageId,
        },
      },
      create: {
        id: ids.nextId("knowledge-point-progress"),
        userId: command.userId,
        goalId: command.goalId,
        lineageId: command.lineageId,
        masteryState: projection.masteryState,
        nextReviewAt: schedule.nextReviewAt,
        policyVersion: projection.policyVersion,
        evidenceAsOf: projection.evidenceAsOf,
      },
      update: {
        masteryState: projection.masteryState,
        nextReviewAt: schedule.nextReviewAt,
        policyVersion: projection.policyVersion,
        evidenceAsOf: projection.evidenceAsOf,
      },
    });
    return toProgressDto({
      userId: command.userId,
      goalId: command.goalId,
      lineageId: command.lineageId,
      point,
    });
  }

  /**
   * Reprojects a single lineage from current on-disk evidence, honoring the
   * profile reset boundary. Used after a human regrade changes the effective
   * verdict of the latest attempt. When no post-reset evidence exists the
   * progress row is reset to the empty projection instead of scheduling a
   * review from stale evidence.
   */
  async function reprojectLineage(
    userId: string,
    goalId: string,
    lineageId: string
  ): Promise<LearningProgressDto> {
    const cutoff = await resolveProfileResetCutoff(userId, goalId, lineageId);
    const latest = await prisma.practiceAttempt.findFirst({
      where: lineageAttemptsFilter(userId, goalId, lineageId, cutoff),
      orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
      include: {
        sessionItem: {
          select: {
            practiceItem: { select: { mode: true } },
          },
        },
        evaluations: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        },
      },
    });
    if (!latest) {
      await prisma.knowledgePointProgress.upsert({
        where: {
          userId_goalId_lineageId: { userId, goalId, lineageId },
        },
        create: {
          id: ids.nextId("knowledge-point-progress"),
          userId,
          goalId,
          lineageId,
          masteryState: "new",
          nextReviewAt: null,
          policyVersion: "progress-v1",
          evidenceAsOf: null,
        },
        update: {
          masteryState: "new",
          nextReviewAt: null,
          evidenceAsOf: null,
        },
      });
      const point = await latestPointForLineage(goalId, lineageId);
      if (!point) {
        throw new LearningServiceError(
          "invalid_state",
          "题目关联的知识点版本不存在",
          409
        );
      }
      return toProgressDto({ userId, goalId, lineageId, point });
    }
    const resolution = resolveActiveEvaluation(
      latest.id,
      latest.evaluations.map(toProgressEvaluation)
    );
    return projectLineageProgress({
      userId,
      goalId,
      lineageId,
      latestAttempt: {
        mode: latest.sessionItem.practiceItem.mode,
        assistanceLevel: latest.assistanceLevel,
        spacingSeconds: latest.spacingSeconds,
      },
      latestEvaluation: {
        verdict:
          resolution.status === "active"
            ? resolution.evaluation.verdict
            : "uncertain",
      },
    });
  }

  async function readItemProgress(command: {
    userId: string;
    goalId: string;
    sessionItem: SessionItemPrivateRecord;
  }): Promise<LearningProgressDto[]> {
    const lineageIds = [
      ...new Set(
        command.sessionItem.practiceItem.knowledgePoints.map(
          ({ knowledgePoint }) => knowledgePoint.lineageId
        )
      ),
    ];
    const points = await Promise.all(
      lineageIds.map((lineageId) =>
        latestPointForLineage(command.goalId, lineageId)
      )
    );
    return Promise.all(
      lineageIds.map((lineageId, index) => {
        const point = points[index];
        if (!point) {
          throw new LearningServiceError(
            "invalid_state",
            "题目关联的知识点版本不存在",
            409
          );
        }
        return toProgressDto({
          userId: command.userId,
          goalId: command.goalId,
          lineageId,
          point,
        });
      })
    );
  }

  async function attemptResult(
    attempt: AttemptResultRecord,
    progress: LearningProgressDto[]
  ): Promise<AttemptSubmissionResult> {
    const evaluation = attempt.evaluations.at(-1);
    if (!evaluation) {
      throw new LearningServiceError(
        "evaluation_uncertain",
        "本次作答尚无可用判定",
        409
      );
    }
    return {
      attempt: {
        id: attempt.id,
        sessionItemId: attempt.sessionItemId,
        answer: attempt.answer,
        assistanceLevel: attempt.assistanceLevel,
        spacingSeconds: attempt.spacingSeconds,
        submittedAt: attempt.submittedAt.toISOString(),
      },
      evaluation: toEvaluationDto(evaluation),
      progress,
      feedback: privateItemFeedback(attempt.sessionItem.practiceItem),
    };
  }

  return {
    async listGoals(command: GoalCommand) {
      await requireProject(command.userId, command.projectId);
      const goals = await prisma.learningGoal.findMany({
        where: {
          userId: command.userId,
          projectId: command.projectId,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      return { goals: goals.map(toGoalDto) };
    },

    async createGoal(
      command: GoalCommand & {
        input: GoalCreateInput;
      }
    ): Promise<LearningGoalDto> {
      await requireProject(command.userId, command.projectId);

      const existing = await prisma.learningGoal.findFirst({
        where: {
          userId: command.userId,
          idempotencyKey: command.input.idempotencyKey,
        },
      });
      if (existing) {
        if (
          existing.projectId !== command.projectId ||
          !sameGoalInput(existing, command.input)
        ) {
          throw new LearningServiceError(
            "idempotency_conflict",
            "该幂等键已用于不同的学习目标请求",
            409
          );
        }
        return toGoalDto(existing);
      }

      const status: LearningGoalStatus = command.input.activate
        ? "active"
        : "paused";
      try {
        const goal = await prisma.$transaction(async (tx) => {
          if (status === "active") {
            await tx.learningGoal.updateMany({
              where: {
                projectId: command.projectId,
                status: "active",
              },
              data: { status: "replaced" },
            });
          }
          return tx.learningGoal.create({
            data: {
              id: ids.nextId("learning-goal"),
              userId: command.userId,
              projectId: command.projectId,
              title: command.input.title,
              purpose: command.input.purpose ?? null,
              targetDate: command.input.targetDate
                ? new Date(command.input.targetDate)
                : null,
              dailyMinutes: command.input.dailyMinutes ?? null,
              status,
              idempotencyKey: command.input.idempotencyKey,
            },
          });
        });
        return toGoalDto(goal);
      } catch (error) {
        const raced = await prisma.learningGoal.findFirst({
          where: {
            userId: command.userId,
            idempotencyKey: command.input.idempotencyKey,
          },
        });
        if (
          raced &&
          raced.projectId === command.projectId &&
          sameGoalInput(raced, command.input)
        ) {
          return toGoalDto(raced);
        }
        throw error;
      }
    },

    async getGoal(
      command: GoalCommand & { goalId: string }
    ): Promise<LearningGoalDto> {
      const goal = await requireGoal(
        command.userId,
        command.projectId,
        command.goalId
      );
      return toGoalDto(goal);
    },

    async updateGoalStatus(
      command: GoalCommand & {
        goalId: string;
        input: GoalStatusInput;
      }
    ): Promise<LearningGoalDto> {
      const goal = await requireGoal(
        command.userId,
        command.projectId,
        command.goalId
      );
      if (goal.status === command.input.status) return toGoalDto(goal);
      if (
        goal.status === "completed" &&
        command.input.status !== "active"
      ) {
        throw new LearningServiceError(
          "invalid_state",
          "已完成目标只能重新激活",
          409
        );
      }

      const updated = await prisma.$transaction(async (tx) => {
        if (command.input.status === "active") {
          await tx.learningGoal.updateMany({
            where: {
              projectId: command.projectId,
              status: "active",
              id: { not: command.goalId },
            },
            data: { status: "replaced" },
          });
        }
        return tx.learningGoal.update({
          where: { id: command.goalId },
          data: { status: command.input.status },
        });
      });
      return toGoalDto(updated);
    },

    async deleteGoal(
      command: GoalCommand & { goalId: string }
    ): Promise<void> {
      await requireGoal(command.userId, command.projectId, command.goalId);
      await prisma.$transaction(async (tx) => {
        // AttemptEvaluation 的 supersession 自引用是 onDelete: Restrict，
        // 目标级联删除会被该外键拦截；同一链条必定属于同一 attempt/goal，
        // 先在事务内解除目标范围内的链接，再整体级联删除。
        await tx.attemptEvaluation.updateMany({
          where: {
            supersedesEvaluationId: { not: null },
            attempt: {
              sessionItem: { session: { goalId: command.goalId } },
            },
          },
          data: { supersedesEvaluationId: null },
        });
        await tx.learningGoal.delete({ where: { id: command.goalId } });
      });
    },

    async getScope(
      command: GoalCommand & { goalId: string }
    ): Promise<LearningScopeDto | null> {
      await requireGoal(command.userId, command.projectId, command.goalId);
      const scope = await prisma.learningScope.findFirst({
        where: { goalId: command.goalId },
        orderBy: [{ version: "desc" }, { id: "desc" }],
      });
      return scope ? toScopeDto(scope) : null;
    },

    async saveScopeDraft(
      command: GoalCommand & {
        goalId: string;
        input: ScopeDraftInput;
      }
    ): Promise<LearningScopeDto> {
      await requireGoal(command.userId, command.projectId, command.goalId);

      const latest = await prisma.learningScope.findFirst({
        where: { goalId: command.goalId },
        orderBy: [{ version: "desc" }, { id: "desc" }],
      });
      if (
        latest &&
        latest.version === command.input.expectedVersion + 1 &&
        latest.status === "draft" &&
        sameScopeInput(latest, command.input)
      ) {
        return toScopeDto(latest);
      }
      if ((latest?.version ?? 0) !== command.input.expectedVersion) {
        throw new LearningServiceError(
          "invalid_state",
          "学习范围版本已变化，请刷新后重试",
          409
        );
      }

      const scope = await prisma.learningScope.create({
        data: {
          id: ids.nextId("learning-scope"),
          goalId: command.goalId,
          version: command.input.expectedVersion + 1,
          status: "draft",
          definition: command.input.definition as Prisma.InputJsonValue,
          materialMode: command.input.materialMode,
          fileIds: [...new Set(command.input.fileIds)],
          materialGaps: command.input.materialGaps,
        },
      });
      return toScopeDto(scope);
    },

    async confirmScope(
      command: GoalCommand & {
        goalId: string;
        input: ScopeConfirmInput;
      }
    ): Promise<LearningScopeDto> {
      await requireGoal(command.userId, command.projectId, command.goalId);
      const latest = await prisma.learningScope.findFirst({
        where: { goalId: command.goalId },
        orderBy: [{ version: "desc" }, { id: "desc" }],
      });
      if (!latest || latest.version !== command.input.expectedVersion) {
        throw new LearningServiceError(
          "invalid_state",
          "学习范围版本已变化，请刷新后重试",
          409
        );
      }
      if (latest.status === "confirmed") {
        return toScopeDto(latest);
      }

      if (latest.materialMode === "selected_files") {
        if (latest.fileIds.length === 0) {
          throw new LearningServiceError(
            "invalid_state",
            "选定资料模式至少需要一份资料",
            409
          );
        }
        const ownedFiles = await prisma.fileAsset.count({
          where: {
            id: { in: latest.fileIds },
            userId: command.userId,
            projectId: command.projectId,
            status: { in: ["parsed", "partial"] },
          },
        });
        if (ownedFiles !== new Set(latest.fileIds).size) {
          throw new LearningServiceError(
            "not_found",
            "部分学习资料不存在或尚不可读",
            404
          );
        }
      }

      const confirmed = await prisma.learningScope.update({
        where: { id: latest.id },
        data: {
          status: "confirmed",
          confirmedAt: clock.now(),
        },
      });
      return toScopeDto(confirmed);
    },

    async getMap(
      command: GoalCommand & { goalId: string }
    ): Promise<KnowledgeMapDto | null> {
      await requireGoal(command.userId, command.projectId, command.goalId);
      const map = await prisma.knowledgeMap.findFirst({
        where: { goalId: command.goalId },
        orderBy: [{ version: "desc" }, { id: "desc" }],
        include: mapInclude,
      });
      return map ? toMapDto(map) : null;
    },

    async generateMap(
      command: GoalCommand & {
        goalId: string;
        input: IdempotentGenerationInput;
      }
    ): Promise<KnowledgeMapDto> {
      const goal = await requireGoal(
        command.userId,
        command.projectId,
        command.goalId
      );
      const existing = await prisma.knowledgeMap.findFirst({
        where: {
          goalId: command.goalId,
          requestKey: command.input.idempotencyKey,
        },
        include: mapInclude,
      });
      if (existing) return toMapDto(existing);

      const scope = await requireConfirmedScope(command.goalId);
      const sources = await buildSourceSnapshots({
        userId: command.userId,
        projectId: command.projectId,
        scope,
      });
      gateSourceQuality(sources);
      const generated = knowledgeMapGenerationSchema.parse(
        await modelGateway.generateKnowledgeMap({
          userId: command.userId,
          goal: {
            id: goal.id,
            title: goal.title,
            purpose: goal.purpose,
          },
          scope: toScopeDto(scope),
          sources: sources.map((source) => ({
            handle: source.handle,
            fileAssetId: source.fileAssetId,
            title: source.title,
            content: source.content,
            contentFingerprint: source.contentFingerprint,
          })),
        })
      );
      const sourceByHandle = new Map(
        sources.map((source) => [source.handle, source])
      );
      for (const point of generated.points) {
        if (point.sourceHandles.some((handle) => !sourceByHandle.has(handle))) {
          const verdict = await classifyCoverage({
            userId: command.userId,
            projectId: command.projectId,
            query: point.name,
            retrievalResults: sources.map((source) => ({
              fileAssetId: source.fileAssetId,
              content: source.content,
            })),
          });
          throw new LearningServiceError(
            "source_unsupported",
            verdict === "material_absent"
              ? `知识点「${point.name}」在当前资料中未找到对应内容，请补充资料后重试`
              : `知识点「${point.name}」在当前资料中可能存在对应内容但未被正确引用，请重新生成知识点地图`,
            409
          );
        }
      }

      const sourceFingerprint = sha256(
        sources
          .map(
            (source) =>
              `${source.fileAssetId}:${source.contentFingerprint}`
          )
          .sort()
          .join("\n")
      );
      try {
        const mapId = ids.nextId("knowledge-map");
        await prisma.$transaction(async (tx) => {
          const aggregate = await tx.knowledgeMap.aggregate({
            where: { goalId: command.goalId },
            _max: { version: true },
          });
          await tx.knowledgeMap.create({
            data: {
              id: mapId,
              goalId: command.goalId,
              scopeId: scope.id,
              version: (aggregate._max.version ?? 0) + 1,
              requestKey: command.input.idempotencyKey,
              sourceFingerprint,
              generationMetadata: {
                sourceCount: sources.length,
              },
            },
          });

          const anchors = new Map<string, string>();
          for (const source of sources) {
            const anchor = await tx.sourceAnchor.upsert({
              where: {
                projectId_anchorKey: {
                  projectId: command.projectId,
                  anchorKey: source.anchorKey,
                },
              },
              create: {
                id: ids.nextId("source-anchor"),
                projectId: command.projectId,
                anchorKey: source.anchorKey,
                fileAssetId: source.fileAssetId,
                documentChunkId: source.documentChunkId ?? null,
                originalFileAssetId: source.fileAssetId,
                originalDocumentChunkId: source.documentChunkId ?? null,
                sourceFileName: source.sourceFileName,
                locator: source.locator as Prisma.InputJsonValue,
                contentFingerprint: source.contentFingerprint,
                excerptHash: source.excerptHash,
              },
              update: {
                fileAssetId: source.fileAssetId,
                documentChunkId: source.documentChunkId ?? null,
              },
            });
            anchors.set(source.handle, anchor.id);
          }

          for (const point of generated.points) {
            const lineage = await tx.knowledgePointLineage.upsert({
              where: {
                goalId_stableKey: {
                  goalId: command.goalId,
                  stableKey: point.stableKey,
                },
              },
              create: {
                id: ids.nextId("knowledge-point-lineage"),
                goalId: command.goalId,
                stableKey: point.stableKey,
                predecessorMetadata: {
                  predecessorStableKeys: point.predecessorStableKeys,
                },
              },
              update: {},
            });
            const knowledgePointId = ids.nextId("knowledge-point");
            await tx.knowledgePoint.create({
              data: {
                id: knowledgePointId,
                knowledgeMapId: mapId,
                lineageId: lineage.id,
                name: point.name,
                kind: point.kind,
                orderIndex: point.order,
                freshness: "current",
              },
            });
            await tx.knowledgePointSourceAnchor.createMany({
              data: point.sourceHandles.map((handle) => ({
                knowledgePointId,
                sourceAnchorId: anchors.get(handle)!,
              })),
              skipDuplicates: true,
            });
          }
        });
        const created = await prisma.knowledgeMap.findUniqueOrThrow({
          where: { id: mapId },
          include: mapInclude,
        });
        return toMapDto(created);
      } catch (error) {
        const raced = await prisma.knowledgeMap.findFirst({
          where: {
            goalId: command.goalId,
            requestKey: command.input.idempotencyKey,
          },
          include: mapInclude,
        });
        if (raced) return toMapDto(raced);
        throw error;
      }
    },

    async createDiagnosticSession(
      command: GoalCommand & {
        goalId: string;
        input: IdempotentGenerationInput;
      }
    ): Promise<LearningSessionDto> {
      await requireGoal(command.userId, command.projectId, command.goalId);
      await requireConfirmedScope(command.goalId);
      const existing = await prisma.learningSession.findFirst({
        where: {
          userId: command.userId,
          idempotencyKey: command.input.idempotencyKey,
        },
        include: sessionInclude,
      });
      if (existing) {
        if (existing.goalId !== command.goalId) {
          throw new LearningServiceError(
            "idempotency_conflict",
            "该幂等键已用于其他学习会话",
            409
          );
        }
        return toSessionDto(existing);
      }

      const map = await prisma.knowledgeMap.findFirst({
        where: { goalId: command.goalId },
        orderBy: [{ version: "desc" }, { id: "desc" }],
        include: mapInclude,
      });
      if (!map) {
        throw new LearningServiceError(
          "invalid_state",
          "请先生成知识点地图",
          409
        );
      }
      const anchors = new Map<
        string,
        MapRecord["knowledgePoints"][number]["sourceLinks"][number]["sourceAnchor"]
      >();
      for (const point of map.knowledgePoints) {
        for (const link of point.sourceLinks) {
          anchors.set(link.sourceAnchor.anchorKey, link.sourceAnchor);
        }
      }
      const anchorRecords = [...anchors.values()];
      const sourceFiles = await prisma.fileAsset.findMany({
        where: {
          id: {
            in: anchorRecords.flatMap((anchor) =>
              anchor.fileAssetId ? [anchor.fileAssetId] : []
            ),
          },
          userId: command.userId,
          projectId: command.projectId,
        },
        select: {
          id: true,
          textContent: true,
          enhancedContent: true,
          enhancementStatus: true,
          contentFingerprint: true,
          processingMetadata: true,
        },
      });
      const sourceFileById = new Map(
        sourceFiles.map((file) => [file.id, file])
      );
      const practiceSources = anchorRecords.map((anchor) => {
        const file = anchor.fileAssetId
          ? sourceFileById.get(anchor.fileAssetId)
          : undefined;
        const content = file ? getEffectiveFileContent(file) : "";
        if (
          !file ||
          !content.trim() ||
          resolveFileFingerprint(file) !== anchor.contentFingerprint
        ) {
          throw new LearningServiceError(
            "source_unsupported",
            "知识点来源已变化，请先重新生成知识点地图",
            409
          );
        }
        const processingMetadata = file.processingMetadata
          ? objectJson(file.processingMetadata)
          : null;
        return {
          handle: anchor.anchorKey,
          fileAssetId: anchor.fileAssetId,
          title: anchor.sourceFileName,
          content,
          contentFingerprint: anchor.contentFingerprint,
          locator: anchor.locator,
          parseReport: processingMetadata?.parseReport,
        };
      });
      gateSourceQuality(practiceSources);
      let generatedItems: z.infer<typeof practiceItemGenerationSchema>[];
      try {
        generatedItems = z
          .object({
            items: z.array(practiceItemGenerationSchema).min(5).max(10),
          })
          .strict()
          .parse(
            await modelGateway.generatePracticeItems({
              userId: command.userId,
              map: toMapDto(map),
              sources: practiceSources,
            })
          ).items;
      } catch (error) {
        if (error instanceof LearningServiceError) throw error;
        // 模型输出不满足题目 schema(如 answerCriteria.kind 与 type 不配对)时,
        // 给出可读错误而不是落入 500 兜底
        throw new LearningServiceError(
          "invalid_state",
          "学习模型生成的题目不符合格式要求，请重试",
          502
        );
      }
      const pointByStableKey = new Map(
        map.knowledgePoints.map((point) => [point.lineage.stableKey, point])
      );
      for (const item of generatedItems) {
        const invalidHandle = item.sourceHandles.find(
          (handle) => !anchors.has(handle)
        );
        if (
          invalidHandle ||
          item.knowledgePointStableKeys.some(
            (stableKey) => !pointByStableKey.has(stableKey)
          )
        ) {
          const verdict =
            invalidHandle === undefined
              ? "covered"
              : await classifyCoverage({
                  userId: command.userId,
                  projectId: command.projectId,
                  query: item.prompt,
                  retrievalResults: practiceSources.map((source) => ({
                    fileAssetId: source.fileAssetId,
                    content: source.content,
                  })),
                });
          throw new LearningServiceError(
            "source_unsupported",
            verdict === "material_absent"
              ? "部分题目在当前资料中未找到对应内容，请补充资料后重试"
              : "诊断题引用了当前地图以外的来源或知识点",
            409
          );
        }
      }

      const sessionId = ids.nextId("learning-session");
      await prisma.$transaction(async (tx) => {
        await tx.learningSession.create({
          data: {
            id: sessionId,
            userId: command.userId,
            goalId: command.goalId,
            knowledgeMapId: map.id,
            mode: "diagnostic",
            status: "ready",
            idempotencyKey: command.input.idempotencyKey,
          },
        });
        for (const [index, item] of generatedItems.entries()) {
          const lineage = await tx.practiceItemLineage.upsert({
            where: {
              goalId_stableKey: {
                goalId: command.goalId,
                stableKey: item.stableKey,
              },
            },
            create: {
              id: ids.nextId("practice-item-lineage"),
              goalId: command.goalId,
              stableKey: item.stableKey,
              predecessorMetadata: {
                predecessorStableKeys: item.predecessorStableKeys,
              },
            },
            update: {},
          });
          const versionAggregate = await tx.practiceItem.aggregate({
            where: { lineageId: lineage.id },
            _max: { version: true },
          });
          const practiceItemId = ids.nextId("practice-item");
          await tx.practiceItem.create({
            data: {
              id: practiceItemId,
              goalId: command.goalId,
              knowledgeMapId: map.id,
              lineageId: lineage.id,
              version: (versionAggregate._max.version ?? 0) + 1,
              prompt: item.prompt,
              type: item.type,
              mode: item.mode,
              freshness: "current",
              ...("options" in item
                ? { options: item.options as Prisma.InputJsonValue }
                : {}),
              generationMetadata: {
                source: "learning-model-gateway",
              },
              answerSpec: {
                create: {
                  id: ids.nextId("practice-item-answer-spec"),
                  criteria: item.answerCriteria as Prisma.InputJsonValue,
                  explanation: item.explanation,
                  graderPolicyVersion: "learning-grading-v1",
                },
              },
              knowledgePoints: {
                create: item.knowledgePointStableKeys.map((stableKey) => ({
                  knowledgePointId: pointByStableKey.get(stableKey)!.id,
                })),
              },
              sourceLinks: {
                create: item.sourceHandles.map((handle) => ({
                  sourceAnchorId: anchors.get(handle)!.id,
                })),
              },
              sessionItems: {
                create: {
                  id: ids.nextId("learning-session-item"),
                  sessionId,
                  orderIndex: index,
                  status: "pending",
                },
              },
            },
          });
        }
      });
      const session = await prisma.learningSession.findUniqueOrThrow({
        where: { id: sessionId },
        include: sessionInclude,
      });
      return toSessionDto(session);
    },

    async getSession(
      command: GoalCommand & { sessionId: string }
    ): Promise<LearningSessionDto> {
      await requireProject(command.userId, command.projectId);
      const session = await prisma.learningSession.findFirst({
        where: {
          id: command.sessionId,
          userId: command.userId,
          goal: { projectId: command.projectId },
        },
        include: sessionInclude,
      });
      if (!session) {
        throw new LearningServiceError("not_found", "学习会话不存在", 404);
      }
      return toSessionDto(session);
    },

    async revealHint(
      command: GoalCommand & {
        sessionId: string;
        sessionItemId: string;
        input: IdempotentGenerationInput;
      }
    ) {
      const { interaction } = await recordInteraction(
        command,
        "hint_revealed"
      );
      return {
        interaction: toInteractionDto(interaction),
        hint:
          "先明确题目对应的知识点，再沿资料锚点回看定义、条件和推导步骤。",
      };
    },

    async revealAnswer(
      command: GoalCommand & {
        sessionId: string;
        sessionItemId: string;
        input: IdempotentGenerationInput;
      }
    ) {
      const { sessionItem, interaction } = await recordInteraction(
        command,
        "answer_revealed"
      );
      return {
        interaction: toInteractionDto(interaction),
        feedback: privateItemFeedback(sessionItem.practiceItem),
      };
    },

    async submitAttempt(
      command: GoalCommand & {
        sessionId: string;
        sessionItemId: string;
        input: AttemptSubmissionInput;
      }
    ): Promise<AttemptSubmissionResult> {
      const sessionItem = await requireSessionItem(command);
      const existing = await prisma.practiceAttempt.findUnique({
        where: {
          userId_idempotencyKey: {
            userId: command.userId,
            idempotencyKey: command.input.idempotencyKey,
          },
        },
        include: attemptResultInclude,
      });
      if (existing) {
        if (
          existing.sessionItemId !== command.sessionItemId ||
          stableJson(existing.answer) !== stableJson(command.input.answer)
        ) {
          throw new LearningServiceError(
            "idempotency_conflict",
            "该幂等键已用于不同的作答",
            409
          );
        }
        return attemptResult(
          existing,
          await readItemProgress({
            userId: command.userId,
            goalId: sessionItem.session.goalId,
            sessionItem,
          })
        );
      }

      const practiceItem = sessionItem.practiceItem;
      if (
        practiceItem.mode === "evidence_bearing" &&
        (practiceItem.freshness !== "current" ||
          practiceItem.knowledgePoints.some(
            ({ knowledgePoint }) =>
              knowledgePoint.freshness !== "current"
          ))
      ) {
        throw new LearningServiceError(
          "source_unsupported",
          "该题来源已变化，请先完成资料重验证",
          409
        );
      }
      if (!practiceItem.answerSpec) {
        throw new LearningServiceError(
          "evaluation_uncertain",
          "该题缺少可验证的判定规则",
          409
        );
      }
      const criteria: AnswerCriteriaDto = answerCriteriaSchema.parse(
        practiceItem.answerSpec.criteria
      );
      const submittedAt = clock.now();
      const previousAttempt = await prisma.practiceAttempt.findFirst({
        where: {
          userId: command.userId,
          sessionItem: {
            is: {
              practiceItem: {
                is: { lineageId: practiceItem.lineageId },
              },
            },
          },
        },
        orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
      });
      const spacingSeconds = previousAttempt
        ? Math.max(
            0,
            Math.floor(
              (submittedAt.getTime() -
                previousAttempt.submittedAt.getTime()) /
                1_000
            )
          )
        : 0;
      const assistanceLevel: AssistanceLevel =
        sessionItem.interactions.some(
          (interaction) => interaction.type === "answer_revealed"
        )
          ? "answer_exposed"
          : sessionItem.interactions.some(
                (interaction) => interaction.type === "hint_revealed"
              )
            ? "hinted"
            : "independent";
      const frozenEvaluation = gradeAttempt({
        mode: practiceItem.mode,
        answer: command.input.answer,
        criteria,
      });

      let attemptId = ids.nextId("practice-attempt");
      try {
        const evaluationId = ids.nextId("attempt-evaluation");
        await prisma.$transaction(async (tx) => {
          await tx.practiceAttempt.create({
            data: {
              id: attemptId,
              userId: command.userId,
              sessionItemId: command.sessionItemId,
              answer: command.input.answer as Prisma.InputJsonValue,
              assistanceLevel,
              spacingSeconds,
              idempotencyKey: command.input.idempotencyKey,
              submittedAt,
            },
          });
          await tx.attemptEvaluation.create({
            data: {
              id: evaluationId,
              attemptId,
              verdict: frozenEvaluation.verdict,
              score: frozenEvaluation.score,
              ...(frozenEvaluation.rubric
                ? {
                    rubric:
                      frozenEvaluation.rubric as Prisma.InputJsonValue,
                  }
                : {}),
              confidence: frozenEvaluation.confidence,
              errorType: frozenEvaluation.errorType,
              reason: frozenEvaluation.reason,
              policyVersion:
                practiceItem.answerSpec!.graderPolicyVersion,
            },
          });
          await tx.learningSessionItem.update({
            where: { id: command.sessionItemId },
            data: { status: "completed" },
          });
          const remaining = await tx.learningSessionItem.count({
            where: {
              sessionId: command.sessionId,
              status: { in: ["pending", "in_progress"] },
            },
          });
          await tx.learningSession.update({
            where: { id: command.sessionId },
            data: {
              status: remaining === 0 ? "completed" : "in_progress",
              startedAt:
                sessionItem.session.startedAt ?? submittedAt,
              completedAt: remaining === 0 ? submittedAt : null,
            },
          });
        });
      } catch (error) {
        const raced = await prisma.practiceAttempt.findUnique({
          where: {
            userId_idempotencyKey: {
              userId: command.userId,
              idempotencyKey: command.input.idempotencyKey,
            },
          },
          include: attemptResultInclude,
        });
        if (
          !raced ||
          raced.sessionItemId !== command.sessionItemId ||
          stableJson(raced.answer) !== stableJson(command.input.answer)
        ) {
          throw error;
        }
        attemptId = raced.id;
      }

      const created = await prisma.practiceAttempt.findUniqueOrThrow({
        where: { id: attemptId },
        include: attemptResultInclude,
      });
      const evaluation = created.evaluations.at(-1);
      if (!evaluation) {
        throw new LearningServiceError(
          "evaluation_uncertain",
          "本次作答尚无可用判定",
          409
        );
      }
      const lineageIds = [
        ...new Set(
          sessionItem.practiceItem.knowledgePoints.map(
            ({ knowledgePoint }) => knowledgePoint.lineageId
          )
        ),
      ];
      const progress = await Promise.all(
        lineageIds.map((lineageId) =>
          projectLineageProgress({
            userId: command.userId,
            goalId: sessionItem.session.goalId,
            lineageId,
            latestAttempt: {
              mode: practiceItem.mode,
              assistanceLevel,
              spacingSeconds,
            },
            latestEvaluation: {
              verdict: evaluation.verdict,
            },
          })
        )
      );
      return attemptResult(created, progress);
    },

    async listReviews(
      command: GoalCommand & { goalId: string }
    ) {
      await requireGoal(command.userId, command.projectId, command.goalId);
      const progressRows = await prisma.knowledgePointProgress.findMany({
        where: {
          userId: command.userId,
          goalId: command.goalId,
          nextReviewAt: { lte: clock.now() },
        },
        orderBy: [{ nextReviewAt: "asc" }, { id: "asc" }],
      });
      const reviews = (
        await Promise.all(
          progressRows.map(async (progress) => {
            const point = await latestPointForLineage(
              command.goalId,
              progress.lineageId
            );
            if (!point || point.freshness === "unsupported") return null;
            const dto = await toProgressDto({
              userId: command.userId,
              goalId: command.goalId,
              lineageId: progress.lineageId,
              point,
            });
            return {
              ...dto,
              reviewState: "due" as const,
            };
          })
        )
      ).filter((review) => review !== null);
      return { reviews };
    },

    async createReviewSession(
      command: GoalCommand & {
        goalId: string;
        input: IdempotentGenerationInput & { limit: number };
      }
    ): Promise<LearningSessionDto> {
      await requireGoal(command.userId, command.projectId, command.goalId);
      const existing = await prisma.learningSession.findFirst({
        where: {
          userId: command.userId,
          idempotencyKey: command.input.idempotencyKey,
        },
        include: sessionInclude,
      });
      if (existing) {
        if (existing.goalId !== command.goalId || existing.mode !== "review") {
          throw new LearningServiceError(
            "idempotency_conflict",
            "该幂等键已用于其他学习会话",
            409
          );
        }
        return toSessionDto(existing);
      }

      const due = await prisma.knowledgePointProgress.findMany({
        where: {
          userId: command.userId,
          goalId: command.goalId,
          nextReviewAt: { lte: clock.now() },
        },
        orderBy: [{ nextReviewAt: "asc" }, { id: "asc" }],
        take: command.input.limit,
        select: { lineageId: true },
      });
      if (due.length === 0) {
        throw new LearningServiceError(
          "invalid_state",
          "当前没有到期复习项",
          409
        );
      }
      const dueLineageIds = due.map(({ lineageId }) => lineageId);
      const reviewCutoffs = await resolveCutoffsByLineage(
        command.userId,
        command.goalId,
        dueLineageIds
      );
      const attemptHistory = await prisma.practiceAttempt.findMany({
        where: {
          OR: dueLineageIds.map((lineageId) =>
            lineageAttemptsFilter(
              command.userId,
              command.goalId,
              lineageId,
              reviewCutoffs.get(lineageId) ?? null
            )
          ),
        },
        orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
        include: attemptResultInclude,
      });
      const attemptsByItemLineage = new Map<string, AttemptResultRecord[]>();
      for (const attempt of attemptHistory) {
        const lineageId = attempt.sessionItem.practiceItem.lineageId;
        const history = attemptsByItemLineage.get(lineageId) ?? [];
        history.push(attempt);
        attemptsByItemLineage.set(lineageId, history);
      }
      const wrongAnswerPriority = new Map<string, number>();
      for (const [itemLineageId, history] of attemptsByItemLineage) {
        const status = wrongAnswerProjectionForHistory(
          itemLineageId,
          history
        ).status;
        if (status === "unresolved") {
          wrongAnswerPriority.set(itemLineageId, 2);
        } else if (status === "resolved") {
          wrongAnswerPriority.set(itemLineageId, 1);
        }
      }
      const candidates = await prisma.practiceItem.findMany({
        where: {
          goalId: command.goalId,
          freshness: "current",
          knowledgePoints: {
            some: {
              knowledgePoint: {
                is: { lineageId: { in: dueLineageIds } },
              },
            },
          },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: {
          knowledgePoints: {
            include: { knowledgePoint: true },
          },
        },
      });
      const prioritizedCandidates = [...candidates].sort(
        (left, right) =>
          (wrongAnswerPriority.get(right.lineageId) ?? 0) -
          (wrongAnswerPriority.get(left.lineageId) ?? 0)
      );
      const chosen: typeof candidates = [];
      const covered = new Set<string>();
      for (const candidate of prioritizedCandidates) {
        const covers = candidate.knowledgePoints
          .map(({ knowledgePoint }) => knowledgePoint.lineageId)
          .filter((lineageId) => dueLineageIds.includes(lineageId));
        if (covers.length === 0 || covers.every((id) => covered.has(id))) {
          continue;
        }
        chosen.push(candidate);
        covers.forEach((id) => covered.add(id));
        if (chosen.length >= command.input.limit) break;
      }
      if (chosen.length === 0) {
        throw new LearningServiceError(
          "source_unsupported",
          "到期知识点没有可用的当前版本题目",
          409
        );
      }
      const map = await prisma.knowledgeMap.findFirst({
        where: { goalId: command.goalId },
        orderBy: [{ version: "desc" }, { id: "desc" }],
      });
      if (!map) {
        throw new LearningServiceError(
          "invalid_state",
          "请先生成知识点地图",
          409
        );
      }
      const sessionId = ids.nextId("learning-session");
      await prisma.$transaction(async (tx) => {
        await tx.learningSession.create({
          data: {
            id: sessionId,
            userId: command.userId,
            goalId: command.goalId,
            knowledgeMapId: map.id,
            mode: "review",
            status: "ready",
            idempotencyKey: command.input.idempotencyKey,
          },
        });
        // 嵌套 create + include 会让查询编译器把子写入并发派发到同一连接
        // (pg 驱动适配器下已弃用)，题目改为单独批量写入。
        await tx.learningSessionItem.createMany({
          data: chosen.map((item, index) => ({
            id: ids.nextId("learning-session-item"),
            sessionId,
            practiceItemId: item.id,
            orderIndex: index,
          })),
        });
      });
      const session = await prisma.learningSession.findUniqueOrThrow({
        where: { id: sessionId },
        include: sessionInclude,
      });
      return toSessionDto(session);
    },

    async listWrongAnswers(
      command: GoalCommand & { goalId: string }
    ) {
      await requireGoal(command.userId, command.projectId, command.goalId);
      const attempts = await prisma.practiceAttempt.findMany({
        where: {
          userId: command.userId,
          sessionItem: {
            is: {
              practiceItem: {
                is: { goalId: command.goalId },
              },
            },
          },
        },
        orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
        include: attemptResultInclude,
      });
      const pointLineageIds = [
        ...new Set(
          attempts.flatMap((attempt) =>
            attempt.sessionItem.practiceItem.knowledgePoints.map(
              ({ knowledgePoint }) => knowledgePoint.lineageId
            )
          )
        ),
      ];
      const cutoffs = await resolveCutoffsByLineage(
        command.userId,
        command.goalId,
        pointLineageIds
      );
      const byLineage = new Map<string, AttemptResultRecord[]>();
      for (const attempt of attempts) {
        const resetBefore = attempt.sessionItem.practiceItem.knowledgePoints.some(
          ({ knowledgePoint }) => {
            const cutoff = cutoffs.get(knowledgePoint.lineageId);
            return cutoff !== undefined && attempt.submittedAt <= cutoff;
          }
        );
        if (resetBefore) continue;
        const lineageId = attempt.sessionItem.practiceItem.lineageId;
        const group = byLineage.get(lineageId) ?? [];
        group.push(attempt);
        byLineage.set(lineageId, group);
      }

      const items = (
        await Promise.all(
          [...byLineage.entries()].map(async ([itemLineageId, history]) => {
            const projection = wrongAnswerProjectionForHistory(
              itemLineageId,
              history
            );
            if (!projection.included) return null;

            const latest = history.at(-1)!;
            const progress = await readItemProgress({
              userId: command.userId,
              goalId: command.goalId,
              sessionItem: latest.sessionItem,
            });
            return {
              policyVersion: projection.policyVersion,
              itemLineageId,
              status: projection.status,
              latestVerdict: projection.latestVerdict,
              triggeringAttemptIds: projection.triggeringAttemptIds,
              resolutionAttemptIds: projection.resolutionAttemptIds,
              feedback: privateItemFeedback(
                latest.sessionItem.practiceItem
              ),
              knowledgePoints: latest.sessionItem.practiceItem.knowledgePoints.map(
                ({ knowledgePoint }) => ({
                  id: knowledgePoint.id,
                  lineageId: knowledgePoint.lineageId,
                  name: knowledgePoint.name,
                })
              ),
              attempts: history.map((attempt) => ({
                id: attempt.id,
                answer: attempt.answer,
                assistanceLevel: attempt.assistanceLevel,
                spacingSeconds: attempt.spacingSeconds,
                submittedAt: attempt.submittedAt.toISOString(),
                evaluations: attempt.evaluations.map(toEvaluationDto),
              })),
              progress,
            };
          })
        )
      ).filter(
        (item): item is NonNullable<typeof item> => item !== null
      );
      return { items };
    },

    async getHistory(
      command: GoalCommand & { goalId: string }
    ): Promise<LearningHistoryDto> {
      const goal = await requireGoal(
        command.userId,
        command.projectId,
        command.goalId
      );
      const map = await prisma.knowledgeMap.findFirst({
        where: { goalId: command.goalId },
        orderBy: [{ version: "desc" }, { id: "desc" }],
        include: mapInclude,
      });
      const attempts = await prisma.practiceAttempt.findMany({
        where: {
          userId: command.userId,
          sessionItem: {
            is: {
              practiceItem: {
                is: { goalId: command.goalId },
              },
            },
          },
        },
        orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
        include: historyAttemptInclude,
      });

      const lineageIds =
        map?.knowledgePoints.map((point) => point.lineageId) ?? [];
      const resetCutoffByLineage = await resolveCutoffsByLineage(
        command.userId,
        command.goalId,
        lineageIds
      );

      const resetBeforeByAttemptId = new Map<string, boolean>();
      const evidenceByPointLineage = new Map<
        string,
        LearningHistoryEvidenceDto[]
      >();
      for (const attempt of attempts) {
        const lineageIds = new Set(
          attempt.sessionItem.practiceItem.knowledgePoints.map(
            ({ knowledgePoint }) => knowledgePoint.lineageId
          )
        );
        const cutoffs = [...lineageIds]
          .map((lineageId) => resetCutoffByLineage.get(lineageId))
          .filter((cutoff): cutoff is Date => cutoff !== undefined);
        const resetBefore = cutoffs.some(
          (cutoff) => attempt.submittedAt <= cutoff
        );
        resetBeforeByAttemptId.set(attempt.id, resetBefore);
        const evidence: LearningHistoryEvidenceDto = {
          ...toHistoryEvidenceDto(attempt),
          resetBefore,
        };
        for (const lineageId of lineageIds) {
          const existing = evidenceByPointLineage.get(lineageId) ?? [];
          existing.push(evidence);
          evidenceByPointLineage.set(lineageId, existing);
        }
      }

      const points: LearningHistoryPointDto[] = map
        ? await Promise.all(
            map.knowledgePoints.map(async (point) => ({
              ...(await toProgressDto({
                userId: command.userId,
                goalId: command.goalId,
                lineageId: point.lineageId,
                point,
              })),
              sourceAnchors: point.sourceLinks.map(({ sourceAnchor }) => ({
                id: sourceAnchor.id,
                fileAssetId: sourceAnchor.fileAssetId,
                sourceFileName: sourceAnchor.sourceFileName,
                locator: objectJson(sourceAnchor.locator),
              })),
              evidence: evidenceByPointLineage.get(point.lineageId) ?? [],
              resetAt: iso(
                resetCutoffByLineage.get(point.lineageId) ?? null
              ),
            }))
          )
        : [];
      const activeAttempts = attempts.filter(
        (attempt) => !resetBeforeByAttemptId.get(attempt.id)
      );
      const manualCorrections = activeAttempts.reduce(
        (total, attempt) =>
          total +
          attempt.evaluations.reduce(
            (evaluationTotal, evaluation) =>
              evaluationTotal + evaluation.errorTypeCorrections.length,
            0
          ),
        0
      );

      return {
        goal: toGoalDto(goal),
        summary: {
          totalPoints: points.length,
          weakPoints: points.filter(
            (point) => point.masteryState === "learning"
          ).length,
          dueReviews: points.filter((point) => point.reviewState === "due")
            .length,
          attempts: activeAttempts.length,
          manualCorrections,
        },
        points,
      };
    },

    async correctEvaluationErrorType(
      command: GoalCommand & {
        goalId: string;
        evaluationId: string;
        input: ErrorTypeCorrectionInput;
      }
    ) {
      await requireGoal(command.userId, command.projectId, command.goalId);
      const evaluation = await prisma.attemptEvaluation.findFirst({
        where: {
          id: command.evaluationId,
          attempt: {
            is: {
              userId: command.userId,
              sessionItem: {
                is: {
                  practiceItem: {
                    is: { goalId: command.goalId },
                  },
                },
              },
            },
          },
        },
        select: { id: true, attemptId: true },
      });
      if (!evaluation) {
        throw new LearningServiceError(
          "not_found",
          "学习判定不存在",
          404
        );
      }

      const attemptEvaluations = await prisma.attemptEvaluation.findMany({
        where: { attemptId: evaluation.attemptId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      const activeEvaluation = resolveActiveEvaluation(
        evaluation.attemptId,
        attemptEvaluations.map((candidate) => ({
          id: candidate.id,
          attemptId: candidate.attemptId,
          supersedesEvaluationId: candidate.supersedesEvaluationId,
          createdAt: candidate.createdAt,
          verdict: candidate.verdict,
          score: candidate.score,
          rubric: candidate.rubric ? objectJson(candidate.rubric) : null,
          confidence: candidate.confidence,
          errorType: candidate.errorType,
          reason: candidate.reason,
        }))
      );
      if (
        activeEvaluation.status !== "active" ||
        activeEvaluation.evaluation.id !== command.evaluationId
      ) {
        throw new LearningServiceError(
          "invalid_state",
          "只能修正当前有效的学习判定",
          409
        );
      }

      const reason = command.input.reason ?? null;
      const existing = await prisma.attemptErrorTypeCorrection.findUnique({
        where: {
          userId_idempotencyKey: {
            userId: command.userId,
            idempotencyKey: command.input.idempotencyKey,
          },
        },
      });
      if (existing) {
        if (
          existing.evaluationId !== command.evaluationId ||
          existing.errorType !== command.input.errorType ||
          existing.reason !== reason
        ) {
          throw new LearningServiceError(
            "idempotency_conflict",
            "该幂等键已用于不同的学习修正",
            409
          );
        }
        return { correction: toErrorTypeCorrectionDto(existing) };
      }

      try {
        const correction = await prisma.attemptErrorTypeCorrection.create({
          data: {
            id: ids.nextId("attempt-error-type-correction"),
            evaluationId: command.evaluationId,
            userId: command.userId,
            errorType: command.input.errorType,
            reason,
            idempotencyKey: command.input.idempotencyKey,
            createdAt: clock.now(),
          },
        });
        return { correction: toErrorTypeCorrectionDto(correction) };
      } catch (error) {
        const raced = await prisma.attemptErrorTypeCorrection.findUnique({
          where: {
            userId_idempotencyKey: {
              userId: command.userId,
              idempotencyKey: command.input.idempotencyKey,
            },
          },
        });
        if (
          raced?.evaluationId === command.evaluationId &&
          raced.errorType === command.input.errorType &&
          raced.reason === reason
        ) {
          return { correction: toErrorTypeCorrectionDto(raced) };
        }
        if (raced) {
          throw new LearningServiceError(
            "idempotency_conflict",
            "该幂等键已用于不同的学习修正",
            409
          );
        }
        throw error;
      }
    },

    async regradeEvaluation(
      command: GoalCommand & {
        goalId: string;
        evaluationId: string;
        input: RegradeInput;
      }
    ): Promise<{
      regrade: LearningRegradeDto;
      progress: LearningProgressDto[];
    }> {
      await requireGoal(command.userId, command.projectId, command.goalId);
      const evaluation = await prisma.attemptEvaluation.findFirst({
        where: {
          id: command.evaluationId,
          attempt: {
            is: {
              userId: command.userId,
              sessionItem: {
                is: {
                  practiceItem: {
                    is: { goalId: command.goalId },
                  },
                },
              },
            },
          },
        },
        include: {
          attempt: {
            include: {
              sessionItem: {
                include: {
                  practiceItem: {
                    include: {
                      knowledgePoints: {
                        include: {
                          knowledgePoint: {
                            select: { lineageId: true },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });
      if (!evaluation) {
        throw new LearningServiceError(
          "not_found",
          "学习判定不存在",
          404
        );
      }

      const score =
        command.input.verdict === "correct"
          ? 1
          : command.input.verdict === "partial"
            ? 0.5
            : command.input.verdict === "incorrect"
              ? 0
              : null;
      const reason = command.input.reason;
      const errorType = command.input.errorType ?? null;
      const existing = await prisma.attemptEvaluation.findUnique({
        where: {
          attemptId_idempotencyKey: {
            attemptId: evaluation.attemptId,
            idempotencyKey: command.input.idempotencyKey,
          },
        },
      });
      if (existing) {
        if (
          existing.supersedesEvaluationId !== command.evaluationId ||
          existing.verdict !== command.input.verdict ||
          existing.errorType !== errorType ||
          existing.reason !== reason
        ) {
          throw new LearningServiceError(
            "idempotency_conflict",
            "该幂等键已用于不同的判定纠正",
            409
          );
        }
        const pointLineageIds = [
          ...new Set(
            evaluation.attempt.sessionItem.practiceItem.knowledgePoints.map(
              ({ knowledgePoint }) => knowledgePoint.lineageId
            )
          ),
        ];
        return {
          regrade: toRegradeDto(existing),
          progress: await Promise.all(
            pointLineageIds.map((lineageId) =>
              reprojectLineage(
                command.userId,
                command.goalId,
                lineageId
              )
            )
          ),
        };
      }

      const attemptEvaluations = await prisma.attemptEvaluation.findMany({
        where: { attemptId: evaluation.attemptId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      const activeEvaluation = resolveActiveEvaluation(
        evaluation.attemptId,
        attemptEvaluations.map(toProgressEvaluation)
      );
      if (
        activeEvaluation.status !== "active" ||
        activeEvaluation.evaluation.id !== command.evaluationId
      ) {
        throw new LearningServiceError(
          "invalid_state",
          "只能纠正当前有效的学习判定",
          409
        );
      }

      const pointLineageIds = [
        ...new Set(
          evaluation.attempt.sessionItem.practiceItem.knowledgePoints.map(
            ({ knowledgePoint }) => knowledgePoint.lineageId
          )
        ),
      ];
      const cutoffs = await resolveCutoffsByLineage(
        command.userId,
        command.goalId,
        pointLineageIds
      );
      const resetBefore = pointLineageIds.some((lineageId) => {
        const cutoff = cutoffs.get(lineageId);
        return (
          cutoff !== undefined &&
          evaluation.attempt.submittedAt <= cutoff
        );
      });
      if (resetBefore) {
        throw new LearningServiceError(
          "invalid_state",
          "该作答位于重置边界之前，无法纠正判定",
          409
        );
      }

      let regrade: Prisma.AttemptEvaluationGetPayload<Record<string, never>>;
      try {
        regrade = await prisma.$transaction(async (tx) => {
          return tx.attemptEvaluation.create({
            data: {
              id: ids.nextId("attempt-evaluation"),
              attemptId: evaluation.attemptId,
              verdict: command.input.verdict,
              score,
              rubric: Prisma.JsonNull,
              confidence: 1,
              errorType,
              reason,
              modelVersion: null,
              policyVersion: "manual-regrade-v1",
              supersedesEvaluationId: command.evaluationId,
              idempotencyKey: command.input.idempotencyKey,
              createdAt: clock.now(),
            },
          });
        });
      } catch (error) {
        const raced = await prisma.attemptEvaluation.findUnique({
          where: {
            attemptId_idempotencyKey: {
              attemptId: evaluation.attemptId,
              idempotencyKey: command.input.idempotencyKey,
            },
          },
        });
        if (
          raced &&
          raced.supersedesEvaluationId === command.evaluationId &&
          raced.verdict === command.input.verdict &&
          raced.errorType === errorType &&
          raced.reason === reason
        ) {
          regrade = raced;
        } else if (raced) {
          throw new LearningServiceError(
            "idempotency_conflict",
            "该幂等键已用于不同的判定纠正",
            409
          );
        } else {
          const superseded = await prisma.attemptEvaluation.findFirst({
            where: { supersedesEvaluationId: command.evaluationId },
            select: { id: true },
          });
          if (superseded) {
            throw new LearningServiceError(
              "invalid_state",
              "该判定已被纠正，请刷新后查看",
              409
            );
          }
          throw error;
        }
      }

      return {
        regrade: toRegradeDto(regrade),
        progress: await Promise.all(
          pointLineageIds.map((lineageId) =>
            reprojectLineage(command.userId, command.goalId, lineageId)
          )
        ),
      };
    },

    async reviseGoal(
      command: GoalCommand & {
        goalId: string;
        input: GoalRevisionInput;
      }
    ): Promise<{
      goal: LearningGoalDto;
      revision: LearningGoalRevisionDto;
    }> {
      const goal = await requireGoal(
        command.userId,
        command.projectId,
        command.goalId
      );
      const reason = command.input.reason;
      const existing = await prisma.learningGoalRevision.findUnique({
        where: {
          userId_idempotencyKey: {
            userId: command.userId,
            idempotencyKey: command.input.idempotencyKey,
          },
        },
      });
      if (existing) {
        const matches =
          existing.goalId === command.goalId &&
          (command.input.title === undefined ||
            existing.title === command.input.title) &&
          (command.input.purpose === undefined ||
            existing.purpose === (command.input.purpose ?? null)) &&
          (command.input.targetDate === undefined ||
            (existing.targetDate === null
              ? command.input.targetDate === null
              : existing.targetDate.toISOString() ===
                command.input.targetDate)) &&
          (command.input.dailyMinutes === undefined ||
            existing.dailyMinutes === (command.input.dailyMinutes ?? null)) &&
          existing.reason === reason;
        if (!matches) {
          throw new LearningServiceError(
            "idempotency_conflict",
            "该幂等键已用于不同的学习目标修订",
            409
          );
        }
        return {
          goal: toGoalDto({
            ...goal,
            title: existing.title,
            purpose: existing.purpose,
            targetDate: existing.targetDate,
            dailyMinutes: existing.dailyMinutes,
          } as never),
          revision: toGoalRevisionDto(existing),
        };
      }
      const targetDate =
        command.input.targetDate === undefined
          ? undefined
          : command.input.targetDate === null
            ? null
            : new Date(command.input.targetDate);
      const changes: {
        title?: string;
        purpose?: string | null;
        targetDate?: Date | null;
        dailyMinutes?: number | null;
      } = {};
      if (
        command.input.title !== undefined &&
        command.input.title !== goal.title
      ) {
        changes.title = command.input.title;
      }
      if (
        command.input.purpose !== undefined &&
        (command.input.purpose ?? null) !== goal.purpose
      ) {
        changes.purpose = command.input.purpose ?? null;
      }
      if (
        targetDate !== undefined &&
        (targetDate === null ? null : iso(targetDate)) !==
          iso(goal.targetDate)
      ) {
        changes.targetDate = targetDate;
      }
      if (
        command.input.dailyMinutes !== undefined &&
        (command.input.dailyMinutes ?? null) !== goal.dailyMinutes
      ) {
        changes.dailyMinutes = command.input.dailyMinutes ?? null;
      }
      if (Object.keys(changes).length === 0) {
        throw new LearningServiceError(
          "invalid_state",
          "没有需要修改的学习目标内容",
          400
        );
      }
      const next = {
        title: changes.title ?? goal.title,
        purpose:
          changes.purpose === undefined ? goal.purpose : changes.purpose,
        targetDate:
          changes.targetDate === undefined
            ? goal.targetDate
            : changes.targetDate,
        dailyMinutes:
          changes.dailyMinutes === undefined
            ? goal.dailyMinutes
            : changes.dailyMinutes,
      };

      try {
        const [updated, revision] = await prisma.$transaction(async (tx) => {
          const updatedGoal = await tx.learningGoal.update({
            where: { id: command.goalId },
            data: changes,
          });
          const revisionRow = await tx.learningGoalRevision.create({
            data: {
              id: ids.nextId("learning-goal-revision"),
              goalId: command.goalId,
              userId: command.userId,
              title: next.title,
              purpose: next.purpose,
              targetDate: next.targetDate,
              dailyMinutes: next.dailyMinutes,
              reason,
              idempotencyKey: command.input.idempotencyKey,
              createdAt: clock.now(),
            },
          });
          return [updatedGoal, revisionRow] as const;
        });
        return { goal: toGoalDto(updated), revision: toGoalRevisionDto(revision) };
      } catch (error) {
        const raced = await prisma.learningGoalRevision.findUnique({
          where: {
            userId_idempotencyKey: {
              userId: command.userId,
              idempotencyKey: command.input.idempotencyKey,
            },
          },
        });
        if (
          raced &&
          raced.goalId === command.goalId &&
          raced.title === next.title &&
          raced.purpose === next.purpose &&
          iso(raced.targetDate) === iso(next.targetDate) &&
          raced.dailyMinutes === next.dailyMinutes &&
          raced.reason === reason
        ) {
          return {
            goal: toGoalDto({ ...goal, ...next } as never),
            revision: toGoalRevisionDto(raced),
          };
        }
        if (raced) {
          throw new LearningServiceError(
            "idempotency_conflict",
            "该幂等键已用于不同的学习目标修订",
            409
          );
        }
        throw error;
      }
    },

    async resetProfile(
      command: {
        userId: string;
        projectId?: string;
        input: ProfileResetInput;
      }
    ): Promise<{ reset: LearningProfileResetDto }> {
      const scope = command.input.scope;
      let goalId: string | null = null;
      let lineageId: string | null = null;
      if (scope.kind === "goal" || scope.kind === "point") {
        if (!command.projectId) {
          throw new LearningServiceError(
            "invalid_state",
            "重置学习画像缺少项目上下文",
            400
          );
        }
        await requireGoal(command.userId, command.projectId, scope.goalId);
        goalId = scope.goalId;
      }
      if (scope.kind === "point") {
        const lineage = await prisma.knowledgePointLineage.findFirst({
          where: {
            id: scope.lineageId,
            goalId: scope.goalId,
          },
          select: { id: true },
        });
        if (!lineage) {
          throw new LearningServiceError(
            "not_found",
            "学习知识点不存在",
            404
          );
        }
        lineageId = scope.lineageId;
      }

      const reason = command.input.reason ?? null;
      const progressWhere: Prisma.KnowledgePointProgressWhereInput =
        goalId === null
          ? { userId: command.userId }
          : lineageId === null
            ? { userId: command.userId, goalId }
            : { userId: command.userId, goalId, lineageId };

      const existing = await prisma.learningProfileReset.findUnique({
        where: {
          userId_idempotencyKey: {
            userId: command.userId,
            idempotencyKey: command.input.idempotencyKey,
          },
        },
      });
      if (existing) {
        if (
          existing.goalId !== goalId ||
          existing.lineageId !== lineageId ||
          existing.reason !== reason
        ) {
          throw new LearningServiceError(
            "idempotency_conflict",
            "该幂等键已用于不同的画像重置",
            409
          );
        }
        const affectedPointCount = await prisma.knowledgePointProgress.count({
          where: progressWhere,
        });
        return {
          reset: toProfileResetDto(existing, affectedPointCount),
        };
      }

      try {
        const [reset, affectedPointCount] = await prisma.$transaction(
          async (tx) => {
            const created = await tx.learningProfileReset.create({
              data: {
                id: ids.nextId("learning-profile-reset"),
                userId: command.userId,
                goalId,
                lineageId,
                reason,
                idempotencyKey: command.input.idempotencyKey,
                createdAt: clock.now(),
              },
            });
            const result = await tx.knowledgePointProgress.updateMany({
              where: progressWhere,
              data: {
                masteryState: "new",
                nextReviewAt: null,
                evidenceAsOf: null,
              },
            });
            return [created, result.count] as const;
          }
        );
        return {
          reset: toProfileResetDto(reset, affectedPointCount),
        };
      } catch (error) {
        const raced = await prisma.learningProfileReset.findUnique({
          where: {
            userId_idempotencyKey: {
              userId: command.userId,
              idempotencyKey: command.input.idempotencyKey,
            },
          },
        });
        if (
          raced &&
          raced.goalId === goalId &&
          raced.lineageId === lineageId &&
          raced.reason === reason
        ) {
          const affectedPointCount =
            await prisma.knowledgePointProgress.count({
              where: progressWhere,
            });
          return {
            reset: toProfileResetDto(raced, affectedPointCount),
          };
        }
        if (raced) {
          throw new LearningServiceError(
            "idempotency_conflict",
            "该幂等键已用于不同的画像重置",
            409
          );
        }
        throw error;
      }
    },

    async listStudyPacks(
      command: GoalCommand & { goalId: string }
    ): Promise<{ packs: StudyPackDto[] }> {
      await requireGoal(command.userId, command.projectId, command.goalId);
      const packs = await prisma.studyPack.findMany({
        where: {
          userId: command.userId,
          goalId: command.goalId,
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        include: studyPackInclude,
      });
      return { packs: packs.map(toStudyPackDto) };
    },

    async createStudyPackDraft(
      command: GoalCommand & {
        goalId: string;
        input: CreateStudyPackInput;
      }
    ): Promise<{ pack: StudyPackDto }> {
      await requireGoal(command.userId, command.projectId, command.goalId);
      await requireConfirmedScope(command.goalId);
      const map = await prisma.knowledgeMap.findFirst({
        where: { goalId: command.goalId },
        orderBy: [{ version: "desc" }, { id: "desc" }],
        include: mapInclude,
      });
      if (!map) {
        throw new LearningServiceError(
          "invalid_state",
          "请先生成知识点地图",
          409
        );
      }
      const goal = await prisma.learningGoal.findFirstOrThrow({
        where: { id: command.goalId },
        select: { title: true },
      });
      const existing = await prisma.studyPack.findUnique({
        where: {
          userId_idempotencyKey: {
            userId: command.userId,
            idempotencyKey: command.input.idempotencyKey,
          },
        },
        include: studyPackInclude,
      });
      if (existing) {
        if (existing.goalId !== command.goalId) {
          throw new LearningServiceError(
            "idempotency_conflict",
            "该幂等键已用于其他学习资料包",
            409
          );
        }
        return { pack: toStudyPackDto(existing) };
      }

      const outline = map.knowledgePoints.map((point) => ({
        key: point.lineage.stableKey,
        title: point.name,
        description: null,
      }));
      if (outline.length === 0) {
        throw new LearningServiceError(
          "invalid_state",
          "知识点地图还没有可整理的章节",
          409
        );
      }
      const title = command.input.title?.trim() || `${goal.title} · 学习资料包`;

      try {
        const packId = ids.nextId("study-pack");
        await prisma.$transaction(async (tx) => {
          await tx.studyPack.create({
            data: {
              id: packId,
              userId: command.userId,
              goalId: command.goalId,
              title,
              outline: outline as Prisma.InputJsonValue,
              outlineStatus: "draft",
              sourceFingerprint: map.sourceFingerprint,
              idempotencyKey: command.input.idempotencyKey,
              createdAt: clock.now(),
            },
          });
          // 嵌套 create + include 会让查询编译器把子写入并发派发到同一连接
          // (pg 驱动适配器下已弃用)，章节改为单独批量写入。
          await tx.studyPackSection.createMany({
            data: outline.map((item, index) => ({
              id: ids.nextId("study-pack-section"),
              packId,
              key: item.key,
              orderIndex: index,
              title: item.title,
              description: null,
              status: "draft",
            })),
          });
        });
        const pack = await prisma.studyPack.findUniqueOrThrow({
          where: { id: packId },
          include: studyPackInclude,
        });
        return { pack: toStudyPackDto(pack) };
      } catch (error) {
        const raced = await prisma.studyPack.findUnique({
          where: {
            userId_idempotencyKey: {
              userId: command.userId,
              idempotencyKey: command.input.idempotencyKey,
            },
          },
          include: studyPackInclude,
        });
        if (raced) {
          if (raced.goalId !== command.goalId) {
            throw new LearningServiceError(
              "idempotency_conflict",
              "该幂等键已用于其他学习资料包",
              409
            );
          }
          return { pack: toStudyPackDto(raced) };
        }
        throw error;
      }
    },

    async updateStudyPackOutline(
      command: GoalCommand & {
        packId: string;
        input: UpdateStudyPackOutlineInput;
      }
    ): Promise<{ pack: StudyPackDto }> {
      const pack = await requireStudyPack(
        command.userId,
        command.projectId,
        command.packId
      );
      if (pack.outlineStatus === "confirmed") {
        throw new LearningServiceError(
          "invalid_state",
          "大纲已确认，不能修改结构，只能重做单个章节",
          409
        );
      }
      const inputOutline = command.input.outline;
      const keys = new Set(inputOutline.map((item) => item.key));
      if (keys.size !== inputOutline.length) {
        throw new LearningServiceError(
          "invalid_state",
          "大纲章节标识不能重复",
          400
        );
      }

      const existingByKey = new Map(
        pack.sections.map((section) => [section.key, section])
      );
      const updated = await prisma.$transaction(async (tx) => {
        const kept: Array<{ key: string; id: string }> = [];
        for (const [index, item] of inputOutline.entries()) {
          const existing = existingByKey.get(item.key);
          if (existing) {
            kept.push({ key: item.key, id: existing.id });
            await tx.studyPackSection.update({
              where: { id: existing.id },
              data: {
                orderIndex: index,
                title: item.title,
                description: item.description ?? null,
              },
            });
          } else {
            const created = await tx.studyPackSection.create({
              data: {
                id: ids.nextId("study-pack-section"),
                packId: command.packId,
                key: item.key,
                orderIndex: index,
                title: item.title,
                description: item.description ?? null,
                status: "draft",
              },
            });
            kept.push({ key: item.key, id: created.id });
          }
        }
        const keptIds = new Set(kept.map((entry) => entry.id));
        await tx.studyPackSection.deleteMany({
          where: { packId: command.packId, id: { notIn: [...keptIds] } },
        });
        return tx.studyPack.update({
          where: { id: command.packId },
          data: {
            outline: inputOutline as Prisma.InputJsonValue,
            outlineStatus:
              command.input.status === "confirmed"
                ? "confirmed"
                : "draft",
          },
          include: studyPackInclude,
        });
      });
      return { pack: toStudyPackDto(updated) };
    },

    async getStudyPack(
      command: GoalCommand & { packId: string }
    ): Promise<{ pack: StudyPackDto }> {
      const pack = await requireStudyPack(
        command.userId,
        command.projectId,
        command.packId
      );
      return { pack: toStudyPackDto(pack) };
    },

    async generateStudyPack(
      command: GoalCommand & {
        packId: string;
        input: GenerateStudyPackInput;
      }
    ): Promise<{ pack: StudyPackDto; generated: number; skipped: number }> {
      const pack = await requireStudyPack(
        command.userId,
        command.projectId,
        command.packId
      );
      if (pack.outlineStatus !== "confirmed") {
        throw new LearningServiceError(
          "invalid_state",
          "请先确认资料包大纲",
          409
        );
      }
      const map = await prisma.knowledgeMap.findFirst({
        where: { goalId: pack.goalId },
        orderBy: [{ version: "desc" }, { id: "desc" }],
        include: mapInclude,
      });
      if (!map) {
        throw new LearningServiceError(
          "invalid_state",
          "请先生成知识点地图",
          409
        );
      }
      if (map.sourceFingerprint !== pack.sourceFingerprint) {
        throw new LearningServiceError(
          "source_unsupported",
          "学习资料已变化，请重新创建资料包",
          409
        );
      }
      const { sources } = await buildStudyPackSources({
        userId: command.userId,
        projectId: command.projectId,
        map,
      });
      const sections = pack.sections;
      let generated = 0;
      let skipped = 0;
      for (const section of sections) {
        if (section.userEditedContent !== null) {
          skipped += 1;
          continue;
        }
        if (section.status === "ready") {
          skipped += 1;
          continue;
        }
        await prisma.studyPackSection.update({
          where: { id: section.id },
          data: { status: "generating", failureReason: null },
        });
        try {
          const result = await generateStudyPackSectionContent({
            userId: command.userId,
            goalId: pack.goalId,
            map,
            section: {
              key: section.key,
              title: section.title,
              description: section.description,
            },
            sources,
          });
          await prisma.studyPackSection.update({
            where: { id: section.id },
            data: {
              status: "ready",
              content: result.content,
              sourceFingerprint: map.sourceFingerprint,
              generationMetadata:
                result.metadata as Prisma.InputJsonValue,
              failureReason: null,
            },
          });
          generated += 1;
        } catch (error) {
          await prisma.studyPackSection.update({
            where: { id: section.id },
            data: {
              status: "failed",
              failureReason:
                error instanceof LearningServiceError
                  ? error.message
                  : "章节生成失败，请重试",
            },
          });
        }
      }
      const refreshed = await requireStudyPack(
        command.userId,
        command.projectId,
        command.packId
      );
      return {
        pack: toStudyPackDto(refreshed),
        generated,
        skipped,
      };
    },

    async saveStudyPackSection(
      command: GoalCommand & {
        packId: string;
        sectionId: string;
        input: SaveStudyPackSectionInput;
      }
    ): Promise<{ section: StudyPackSectionDto }> {
      const pack = await requireStudyPack(
        command.userId,
        command.projectId,
        command.packId
      );
      const section = await requireStudyPackSection(pack, command.sectionId);
      const updated = await prisma.studyPackSection.update({
        where: { id: section.id },
        data: {
          userEditedContent: command.input.content,
          userEditedAt: clock.now(),
          status: section.status === "ready" ? "ready" : section.status,
          failureReason: null,
        },
      });
      return { section: toStudyPackSectionDto(updated) };
    },

    async regenerateStudyPackSection(
      command: GoalCommand & {
        packId: string;
        sectionId: string;
        input: GenerateStudyPackInput;
      }
    ): Promise<{ section: StudyPackSectionDto }> {
      const pack = await requireStudyPack(
        command.userId,
        command.projectId,
        command.packId
      );
      if (pack.outlineStatus !== "confirmed") {
        throw new LearningServiceError(
          "invalid_state",
          "请先确认资料包大纲",
          409
        );
      }
      const section = await requireStudyPackSection(pack, command.sectionId);
      const map = await prisma.knowledgeMap.findFirst({
        where: { goalId: pack.goalId },
        orderBy: [{ version: "desc" }, { id: "desc" }],
        include: mapInclude,
      });
      if (!map) {
        throw new LearningServiceError(
          "invalid_state",
          "请先生成知识点地图",
          409
        );
      }
      if (map.sourceFingerprint !== pack.sourceFingerprint) {
        throw new LearningServiceError(
          "source_unsupported",
          "学习资料已变化，请重新创建资料包",
          409
        );
      }
      const { sources } = await buildStudyPackSources({
        userId: command.userId,
        projectId: command.projectId,
        map,
      });
      await prisma.studyPackSection.update({
        where: { id: section.id },
        data: { status: "generating", failureReason: null },
      });
      try {
        const result = await generateStudyPackSectionContent({
          userId: command.userId,
          goalId: pack.goalId,
          map,
          section: {
            key: section.key,
            title: section.title,
            description: section.description,
          },
          sources,
        });
        const updated = await prisma.studyPackSection.update({
          where: { id: section.id },
          data: {
            status: "ready",
            content: result.content,
            sourceFingerprint: map.sourceFingerprint,
            generationMetadata: result.metadata as Prisma.InputJsonValue,
            failureReason: null,
          },
        });
        return { section: toStudyPackSectionDto(updated) };
      } catch (error) {
        const failed = await prisma.studyPackSection.update({
          where: { id: section.id },
          data: {
            status: "failed",
            failureReason:
              error instanceof LearningServiceError
                ? error.message
                : "章节生成失败，请重试",
          },
        });
        return { section: toStudyPackSectionDto(failed) };
      }
    },

    async publishStudyPack(
      command: GoalCommand & {
        packId: string;
        input: PublishStudyPackInput;
      }
    ): Promise<{
      pack: StudyPackDto;
      artifact: { id: string; title: string };
    }> {
      const pack = await requireStudyPack(
        command.userId,
        command.projectId,
        command.packId
      );
      if (pack.publishedArtifactId) {
        const artifact = await prisma.artifact.findUnique({
          where: { id: pack.publishedArtifactId },
          select: { id: true, title: true },
        });
        if (artifact) {
          return {
            pack: toStudyPackDto(pack),
            artifact,
          };
        }
      }
      const readySections = pack.sections.filter((section) => {
        const effective = section.userEditedContent ?? section.content;
        return effective !== null && effective.trim().length > 0;
      });
      if (readySections.length === 0) {
        throw new LearningServiceError(
          "invalid_state",
          "资料包还没有可发布的内容，请先生成或编辑章节",
          409
        );
      }
      const body = readySections
        .map((section) => {
          const effective = section.userEditedContent ?? section.content!;
          return `## ${section.title}\n\n${effective.trim()}\n`;
        })
        .join("\n");
      const content = `# ${pack.title}\n\n${body}`.trim();
      const artifact = await prisma.artifact.create({
        data: {
          userId: command.userId,
          projectId: command.projectId,
          title: pack.title,
          type: "review_outline",
          content,
          metadata: {
            studyPackId: pack.id,
            goalId: pack.goalId,
          },
        },
      });
      await prisma.studyPack.update({
        where: { id: pack.id },
        data: { publishedArtifactId: artifact.id },
      });
      const refreshed = await requireStudyPack(
        command.userId,
        command.projectId,
        command.packId
      );
      return {
        pack: toStudyPackDto(refreshed),
        artifact: { id: artifact.id, title: artifact.title },
      };
    },

    async deleteStudyPack(
      command: GoalCommand & { packId: string }
    ): Promise<void> {
      const pack = await requireStudyPack(
        command.userId,
        command.projectId,
        command.packId
      );
      // 章节随资料包级联删除；已发布的成果是独立的 Artifact，保留不删。
      await prisma.studyPack.delete({ where: { id: pack.id } });
    },

    async getProgress(
      command: GoalCommand & { goalId: string }
    ) {
      await requireGoal(command.userId, command.projectId, command.goalId);
      const map = await prisma.knowledgeMap.findFirst({
        where: { goalId: command.goalId },
        orderBy: [{ version: "desc" }, { id: "desc" }],
        include: mapInclude,
      });
      if (!map) {
        return {
          summary: {
            total: 0,
            new: 0,
            learning: 0,
            mastered: 0,
            due: 0,
            needsRevalidation: 0,
            unsupported: 0,
          },
          points: [] as LearningProgressDto[],
        };
      }
      const points = await Promise.all(
        map.knowledgePoints.map((point) =>
          toProgressDto({
            userId: command.userId,
            goalId: command.goalId,
            lineageId: point.lineageId,
            point,
          })
        )
      );
      return {
        summary: {
          total: points.length,
          new: points.filter((point) => point.masteryState === "new").length,
          learning: points.filter(
            (point) => point.masteryState === "learning"
          ).length,
          mastered: points.filter(
            (point) => point.masteryState === "mastered"
          ).length,
          due: points.filter((point) => point.reviewState === "due").length,
          needsRevalidation: points.filter(
            (point) => point.freshness === "needs_revalidation"
          ).length,
          unsupported: points.filter(
            (point) => point.freshness === "unsupported"
          ).length,
        },
        points,
      };
    },

    async getToday(command: { userId: string }) {
      const goals = await prisma.learningGoal.findMany({
        where: {
          userId: command.userId,
          status: "active",
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        include: {
          project: {
            select: { id: true, name: true },
          },
        },
      });
      const entries = await Promise.all(
        goals.map(async (goal) => {
          const [scope, map] = await Promise.all([
            prisma.learningScope.findFirst({
              where: { goalId: goal.id },
              orderBy: [{ version: "desc" }, { id: "desc" }],
            }),
            prisma.knowledgeMap.findFirst({
              where: { goalId: goal.id },
              orderBy: [{ version: "desc" }, { id: "desc" }],
              include: mapInclude,
            }),
          ]);
          const points = map
            ? await Promise.all(
                map.knowledgePoints.map((point) =>
                  toProgressDto({
                    userId: command.userId,
                    goalId: goal.id,
                    lineageId: point.lineageId,
                    point,
                  })
                )
              )
            : [];
          const summary = {
            total: points.length,
            new: points.filter((point) => point.masteryState === "new")
              .length,
            learning: points.filter(
              (point) => point.masteryState === "learning"
            ).length,
            mastered: points.filter(
              (point) => point.masteryState === "mastered"
            ).length,
            due: points.filter((point) => point.reviewState === "due")
              .length,
            needsRevalidation: points.filter(
              (point) => point.freshness === "needs_revalidation"
            ).length,
            unsupported: points.filter(
              (point) => point.freshness === "unsupported"
            ).length,
          };
          let nextAction:
            | {
                type:
                  | "confirm_scope"
                  | "generate_map"
                  | "start_diagnostic"
                  | "review"
                  | "continue_learning";
                href: string;
                dueCount?: number;
                nextReviewAt?: string | null;
              };
          const baseHref = `/learning?project=${encodeURIComponent(goal.projectId)}`;
          if (!scope || scope.status !== "confirmed") {
            nextAction = {
              type: "confirm_scope",
              href: `${baseHref}&goal=${goal.id}&step=scope`,
            };
          } else if (!map) {
            nextAction = {
              type: "generate_map",
              href: `${baseHref}&goal=${goal.id}&step=map`,
            };
          } else if (
            points.every((point) => point.evidenceAsOf === null)
          ) {
            nextAction = {
              type: "start_diagnostic",
              href: `${baseHref}&goal=${goal.id}&step=diagnostic`,
            };
          } else if (summary.due > 0) {
            nextAction = {
              type: "review",
              href: `${baseHref}&goal=${goal.id}&step=review`,
              dueCount: summary.due,
            };
          } else {
            const scheduled = points
              .map((point) => point.nextReviewAt)
              .filter((value): value is string => value !== null)
              .sort()[0] ?? null;
            nextAction = {
              type: "continue_learning",
              href: `${baseHref}&goal=${goal.id}`,
              nextReviewAt: scheduled,
            };
          }
          return {
            goal: toGoalDto(goal),
            project: goal.project,
            summary,
            nextAction,
          };
        })
      );
      return {
        asOf: clock.now().toISOString(),
        goals: entries,
      };
    },

    async recordFileContentChange(command: {
      userId: string;
      fileAssetId: string;
      previousFingerprint: string;
      currentFingerprint: string;
    }) {
      if (
        !command.previousFingerprint.trim() ||
        !command.currentFingerprint.trim()
      ) {
        throw new LearningServiceError(
          "invalid_state",
          "资料指纹不能为空",
          400
        );
      }
      if (command.previousFingerprint === command.currentFingerprint) {
        return {
          changed: false,
          knowledgePoints: [],
          practiceItems: [],
        };
      }
      const owned = await prisma.fileAsset.findFirst({
        where: {
          id: command.fileAssetId,
          userId: command.userId,
        },
        select: { id: true },
      });
      if (!owned) {
        throw new LearningServiceError("not_found", "学习资料不存在", 404);
      }
      return updateFreshnessForFile({
        ...command,
        deletion: false,
      });
    },

    async recordFileDeletion(command: {
      userId: string;
      fileAssetId: string;
      previousFingerprint: string;
    }) {
      if (!command.previousFingerprint.trim()) {
        throw new LearningServiceError(
          "invalid_state",
          "资料指纹不能为空",
          400
        );
      }
      return updateFreshnessForFile({
        ...command,
        currentFingerprint: null,
        deletion: true,
      });
    },
  };

  async function updateFreshnessForFile(command: {
    userId: string;
    fileAssetId: string;
    previousFingerprint: string;
    currentFingerprint: string | null;
    deletion: boolean;
  }) {
    const targetAnchors = await prisma.sourceAnchor.findMany({
      where: {
        originalFileAssetId: command.fileAssetId,
        contentFingerprint: command.previousFingerprint,
        project: {
          is: { userId: command.userId },
        },
      },
      select: { id: true },
    });
    if (targetAnchors.length === 0) {
      return {
        changed: false,
        knowledgePoints: [],
        practiceItems: [],
      };
    }
    const targetAnchorIds = new Set(
      targetAnchors.map((anchor) => anchor.id)
    );
    const [pointLinks, itemLinks] = await Promise.all([
      prisma.knowledgePointSourceAnchor.findMany({
        where: { sourceAnchorId: { in: [...targetAnchorIds] } },
        select: { knowledgePointId: true },
      }),
      prisma.practiceItemSourceAnchor.findMany({
        where: { sourceAnchorId: { in: [...targetAnchorIds] } },
        select: { practiceItemId: true },
      }),
    ]);
    const pointIds = [
      ...new Set(pointLinks.map((link) => link.knowledgePointId)),
    ];
    const itemIds = [
      ...new Set(itemLinks.map((link) => link.practiceItemId)),
    ];
    const [points, items] = await Promise.all([
      prisma.knowledgePoint.findMany({
        where: { id: { in: pointIds } },
        include: {
          sourceLinks: {
            include: {
              sourceAnchor: {
                include: {
                  fileAsset: {
                    select: { contentFingerprint: true },
                  },
                },
              },
            },
          },
        },
      }),
      prisma.practiceItem.findMany({
        where: { id: { in: itemIds } },
        include: {
          sourceLinks: {
            include: {
              sourceAnchor: {
                include: {
                  fileAsset: {
                    select: { contentFingerprint: true },
                  },
                },
              },
            },
          },
        },
      }),
    ]);

    const currentFingerprintFor = (anchor: {
      id: string;
      fileAsset: { contentFingerprint: string | null } | null;
    }) =>
      targetAnchorIds.has(anchor.id)
        ? command.currentFingerprint
        : anchor.fileAsset?.contentFingerprint ?? null;
    const pointChanges: Array<{
      id: string;
      freshness: ContentFreshness;
    }> = [];
    for (const point of points) {
      const decision = deriveFreshness({
        anchors: point.sourceLinks.map(({ sourceAnchor }) => ({
          anchorId: sourceAnchor.id,
          recordedFingerprint: sourceAnchor.contentFingerprint,
          currentFingerprint: currentFingerprintFor(sourceAnchor),
        })),
      });
      if (point.freshness !== decision.freshness) {
        await prisma.knowledgePoint.update({
          where: { id: point.id },
          data: { freshness: decision.freshness },
        });
      }
      pointChanges.push({
        id: point.id,
        freshness: decision.freshness,
      });

      const latest = await latestPointForLineage(
        point.knowledgeMapId
          ? (
              await prisma.knowledgeMap.findUniqueOrThrow({
                where: { id: point.knowledgeMapId },
                select: { goalId: true },
              })
            ).goalId
          : "",
        point.lineageId
      );
      if (latest?.id === point.id) {
        await prisma.knowledgePointProgress.updateMany({
          where: { lineageId: point.lineageId },
          data: {
            nextReviewAt:
              decision.freshness === "needs_revalidation"
                ? clock.now()
                : decision.freshness === "unsupported"
                  ? null
                  : undefined,
          },
        });
      }
    }
    const itemChanges: Array<{
      id: string;
      freshness: ContentFreshness;
    }> = [];
    for (const item of items) {
      const decision = deriveFreshness({
        anchors: item.sourceLinks.map(({ sourceAnchor }) => ({
          anchorId: sourceAnchor.id,
          recordedFingerprint: sourceAnchor.contentFingerprint,
          currentFingerprint: currentFingerprintFor(sourceAnchor),
        })),
      });
      if (item.freshness !== decision.freshness) {
        await prisma.practiceItem.update({
          where: { id: item.id },
          data: { freshness: decision.freshness },
        });
      }
      itemChanges.push({
        id: item.id,
        freshness: decision.freshness,
      });
    }
    return {
      changed: pointChanges.length > 0 || itemChanges.length > 0,
      knowledgePoints: pointChanges,
      practiceItems: itemChanges,
    };
  }
}

export type LearningService = ReturnType<typeof createLearningService>;
