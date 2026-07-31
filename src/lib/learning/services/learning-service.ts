import "server-only";

import { createHash } from "node:crypto";

import {
  deriveReviewState,
  LearningServiceError,
  type AnswerCriteriaDto,
  type AssistanceLevel,
  type ContentFreshness,
  type EvaluationVerdict,
  type LearningClock,
  type LearningIdGenerator,
  type LearningModelGateway,
  type PracticeItemPublicDto,
} from "@/lib/learning/contracts";
import { gradeAttempt } from "@/lib/learning/grading";
import {
  deriveFreshness,
  deriveWrongAnswer,
  projectProgress,
  scheduleReview,
  type ProgressEvaluation,
  type WrongAnswerAttempt,
} from "@/lib/learning/policy";
import type {
  LearningGoalStatus,
  LearningMaterialMode,
  Prisma,
  PrismaClient,
} from "@/generated/prisma/client";
import type {
  learningGoalCreateSchema,
  learningScopeConfirmSchema,
  learningScopeDraftSchema,
  practiceAttemptSubmissionSchema,
} from "@/lib/learning/validators";
import {
  answerCriteriaSchema,
  knowledgeMapGenerationSchema,
  practiceItemGenerationSchema,
  sourceAnchorSnapshotSchema,
} from "@/lib/learning/validators";
import { z } from "zod";
import { getEffectiveFileContent } from "@/lib/files/content-fingerprint";

type GoalCreateInput = z.infer<typeof learningGoalCreateSchema>;
type ScopeDraftInput = z.infer<typeof learningScopeDraftSchema>;
type ScopeConfirmInput = z.infer<typeof learningScopeConfirmSchema>;
type AttemptSubmissionInput = z.infer<typeof practiceAttemptSubmissionSchema>;

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

    return files.map((file) => {
      const content =
        file.enhancementStatus === "enhanced" && file.enhancedContent
          ? file.enhancedContent
          : file.textContent ?? "";
      if (!content.trim() || !file.contentFingerprint) {
        throw new LearningServiceError(
          "source_unsupported",
          `资料 ${file.originalName} 缺少可验证的正文指纹`,
          409
        );
      }
      const handle = sha256(
        `${command.projectId}\n${file.id}\n${file.contentFingerprint}`
      );
      const snapshot = sourceAnchorSnapshotSchema.parse({
        projectId: command.projectId,
        anchorKey: handle,
        fileAssetId: file.id,
        sourceFileName: file.originalName,
        documentChunkId: null,
        locator: { kind: "file" },
        contentFingerprint: file.contentFingerprint,
        excerptHash: sha256(content),
      });
      return {
        ...snapshot,
        handle,
        title: file.originalName,
        content,
      };
    });
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

    const attempts = await prisma.practiceAttempt.findMany({
      where: {
        userId: command.userId,
        sessionItem: {
          is: {
            practiceItem: {
              is: {
                knowledgePoints: {
                  some: {
                    knowledgePoint: {
                      is: { lineageId: command.lineageId },
                    },
                  },
                },
              },
            },
          },
        },
      },
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
          throw new LearningServiceError(
            "source_unsupported",
            "知识点引用了未确认的资料来源",
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
          file.contentFingerprint !== anchor.contentFingerprint
        ) {
          throw new LearningServiceError(
            "source_unsupported",
            "知识点来源已变化，请先重新生成知识点地图",
            409
          );
        }
        return {
          handle: anchor.anchorKey,
          fileAssetId: anchor.fileAssetId,
          title: anchor.sourceFileName,
          content,
          contentFingerprint: anchor.contentFingerprint,
          locator: anchor.locator,
        };
      });
      const generatedItems = z
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
      const pointByStableKey = new Map(
        map.knowledgePoints.map((point) => [point.lineage.stableKey, point])
      );
      for (const item of generatedItems) {
        if (
          item.sourceHandles.some((handle) => !anchors.has(handle)) ||
          item.knowledgePointStableKeys.some(
            (stableKey) => !pointByStableKey.has(stableKey)
          )
        ) {
          throw new LearningServiceError(
            "source_unsupported",
            "诊断题引用了当前地图以外的来源或知识点",
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
      const chosen: typeof candidates = [];
      const covered = new Set<string>();
      for (const candidate of candidates) {
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
      const session = await prisma.learningSession.create({
        data: {
          id: ids.nextId("learning-session"),
          userId: command.userId,
          goalId: command.goalId,
          knowledgeMapId: map.id,
          mode: "review",
          status: "ready",
          idempotencyKey: command.input.idempotencyKey,
          items: {
            create: chosen.map((item, index) => ({
              id: ids.nextId("learning-session-item"),
              practiceItemId: item.id,
              orderIndex: index,
            })),
          },
        },
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
      const byLineage = new Map<string, AttemptResultRecord[]>();
      for (const attempt of attempts) {
        const lineageId = attempt.sessionItem.practiceItem.lineageId;
        const group = byLineage.get(lineageId) ?? [];
        group.push(attempt);
        byLineage.set(lineageId, group);
      }

      const items = (
        await Promise.all(
          [...byLineage.entries()].map(async ([itemLineageId, history]) => {
            const wrongAnswerAttempts: WrongAnswerAttempt[] = history.map(
              (attempt) => ({
                id: attempt.id,
                itemLineageId,
                mode: attempt.sessionItem.practiceItem.mode,
                assistanceLevel: attempt.assistanceLevel,
                spacingSeconds: attempt.spacingSeconds,
                submittedAt: attempt.submittedAt,
              })
            );
            const evaluations: ProgressEvaluation[] = history.flatMap(
              (attempt) =>
                attempt.evaluations.map((evaluation) => ({
                  id: evaluation.id,
                  attemptId: evaluation.attemptId,
                  supersedesEvaluationId:
                    evaluation.supersedesEvaluationId,
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
            const projection = deriveWrongAnswer({
              itemLineageId,
              attempts: wrongAnswerAttempts,
              evaluations,
            });
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
          const baseHref = `/projects/${goal.projectId}/learning`;
          if (!scope || scope.status !== "confirmed") {
            nextAction = {
              type: "confirm_scope",
              href: `${baseHref}?goal=${goal.id}&step=scope`,
            };
          } else if (!map) {
            nextAction = {
              type: "generate_map",
              href: `${baseHref}?goal=${goal.id}&step=map`,
            };
          } else if (
            points.every((point) => point.evidenceAsOf === null)
          ) {
            nextAction = {
              type: "start_diagnostic",
              href: `${baseHref}?goal=${goal.id}&step=diagnostic`,
            };
          } else if (summary.due > 0) {
            nextAction = {
              type: "review",
              href: `${baseHref}?goal=${goal.id}&step=review`,
              dueCount: summary.due,
            };
          } else {
            const scheduled = points
              .map((point) => point.nextReviewAt)
              .filter((value): value is string => value !== null)
              .sort()[0] ?? null;
            nextAction = {
              type: "continue_learning",
              href: `${baseHref}?goal=${goal.id}`,
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
