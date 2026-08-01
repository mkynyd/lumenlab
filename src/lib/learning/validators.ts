import { z } from "zod";

import {
  ASSISTANCE_LEVELS,
  CONTENT_FRESHNESS_STATES,
  EVALUATION_VERDICTS,
  LEARNING_GOAL_STATUSES,
  LEARNING_SCOPE_STATUSES,
  LEARNING_SESSION_MODES,
  LEARNING_SESSION_STATUSES,
  MASTERY_STATES,
  PRACTICE_MODES,
} from "@/lib/learning/contracts";

const stableKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/);

/**
 * Locator v2 — precise source positions frozen by P1-C. `file` remains the
 * fallback for files without block-annotated chunks; `page` / `block` / `range`
 * are written by the learning service after resolving current DocumentChunk
 * metadata, never accepted from the model.
 */
export const sourceLocatorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("file") }).strict(),
  z
    .object({
      kind: z.literal("page"),
      page: z.number().int().positive(),
      paragraph: z.number().int().positive().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("block"),
      blockId: z.string().trim().min(1),
      pageNumber: z.number().int().positive().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("range"),
      start: z.number().int().nonnegative(),
      end: z.number().int().positive(),
      page: z.number().int().positive().optional(),
    })
    .strict(),
]);

export type SourceLocator = z.infer<typeof sourceLocatorSchema>;

/** Accepts locator v2 strictly, but tolerates legacy free-form locators. */
const locatorSchema = z.union([
  sourceLocatorSchema,
  z.record(z.string().min(1).max(80), z.unknown()),
]);

export const learningGoalStatusSchema = z.enum(LEARNING_GOAL_STATUSES);
export const learningScopeStatusSchema = z.enum(LEARNING_SCOPE_STATUSES);
export const practiceModeSchema = z.enum(PRACTICE_MODES);
export const assistanceLevelSchema = z.enum(ASSISTANCE_LEVELS);
export const evaluationVerdictSchema = z.enum(EVALUATION_VERDICTS);
export const masteryStateSchema = z.enum(MASTERY_STATES);
export const contentFreshnessSchema = z.enum(CONTENT_FRESHNESS_STATES);
export const learningSessionModeSchema = z.enum(LEARNING_SESSION_MODES);
export const learningSessionStatusSchema = z.enum(LEARNING_SESSION_STATUSES);

export const learningGoalCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    purpose: z.string().trim().max(2_000).nullish(),
    targetDate: z.string().datetime({ offset: true }).nullish(),
    dailyMinutes: z.number().int().min(5).max(480).nullish(),
    activate: z.boolean().default(true),
    idempotencyKey: z.string().trim().min(1).max(200),
  })
  .strict();

export const learningScopeDraftSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    definition: z.record(z.string().min(1).max(120), z.unknown()),
    materialMode: z.enum(["project_corpus", "selected_files"]),
    fileIds: z.array(z.string().trim().min(1)).max(500),
    materialGaps: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
    idempotencyKey: z.string().trim().min(1).max(200),
  })
  .strict();

export const learningScopeConfirmSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    idempotencyKey: z.string().trim().min(1).max(200),
  })
  .strict();

/**
 * Server-owned anchor snapshot. Hashes are computed from the confirmed project
 * material and never accepted as model claims.
 */
export const sourceAnchorSnapshotSchema = z
  .object({
    projectId: z.string().trim().min(1),
    anchorKey: z.string().trim().min(1).max(240),
    fileAssetId: z.string().trim().min(1),
    sourceFileName: z.string().trim().min(1).max(500),
    documentChunkId: z.string().trim().min(1).nullish(),
    locator: locatorSchema,
    contentFingerprint: z.string().trim().min(8).max(200),
    excerptHash: z.string().trim().min(8).max(200),
  })
  .strict();

export const knowledgePointGenerationSchema = z
  .object({
    stableKey: stableKeySchema,
    name: z.string().trim().min(1).max(240),
    kind: z.string().trim().min(1).max(80),
    order: z.number().int().nonnegative(),
    predecessorStableKeys: z.array(stableKeySchema).max(20).default([]),
    sourceHandles: z.array(z.string().trim().min(1).max(240)).min(1).max(50),
  })
  .strict();

export const knowledgeMapGenerationSchema = z
  .object({
    points: z.array(knowledgePointGenerationSchema).min(1).max(300),
  })
  .strict();

export const answerCriteriaSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("single_choice"),
      selectedOptionId: stableKeySchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("multiple_choice"),
      requiredOptionIds: z.array(stableKeySchema).min(1).max(20),
    })
    .strict(),
  z
    .object({
      kind: z.literal("boolean"),
      expected: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("numeric"),
      expected: z.number().finite(),
      absoluteTolerance: z.number().finite().nonnegative(),
      unit: z.string().trim().min(1).max(80).nullable().default(null),
    })
    .strict(),
  z
    .object({
      kind: z.literal("keywords"),
      required: z.array(z.string().trim().min(1).max(200)).min(1).max(50),
      optional: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("rubric"),
      criteria: z
        .array(
          z
            .object({
              label: z.string().trim().min(1).max(160),
              description: z.string().trim().min(1).max(1_000),
              weight: z.number().finite().positive(),
            })
            .strict()
        )
        .min(1)
        .max(20),
    })
    .strict()
    .superRefine((value, context) => {
      const total = value.criteria.reduce(
        (sum, criterion) => sum + criterion.weight,
        0
      );
      if (Math.abs(total - 1) > 0.000_001) {
        context.addIssue({
          code: "custom",
          path: ["criteria"],
          message: "Rubric weights must sum to 1.",
        });
      }
    }),
]);

const optionSchema = z
  .object({
    id: stableKeySchema,
    label: z.string().trim().min(1).max(2_000),
  })
  .strict();

const practiceGenerationBase = {
  stableKey: stableKeySchema,
  prompt: z.string().trim().min(1).max(20_000),
  explanation: z.string().trim().min(1).max(20_000),
  sourceHandles: z.array(z.string().trim().min(1).max(240)).max(50),
  knowledgePointStableKeys: z.array(stableKeySchema).min(1).max(30),
  predecessorStableKeys: z.array(stableKeySchema).max(20).default([]),
};

export const practiceItemGenerationSchema = z
  .discriminatedUnion("type", [
    z
      .object({
        ...practiceGenerationBase,
        type: z.literal("single_choice"),
        mode: z.literal("evidence_bearing"),
        options: z.array(optionSchema).min(2).max(20),
        answerCriteria: z
          .object({
            kind: z.literal("single_choice"),
            selectedOptionId: stableKeySchema,
          })
          .strict(),
      })
      .strict(),
    z
      .object({
        ...practiceGenerationBase,
        type: z.literal("multiple_choice"),
        mode: z.literal("evidence_bearing"),
        options: z.array(optionSchema).min(2).max(20),
        answerCriteria: z
          .object({
            kind: z.literal("multiple_choice"),
            requiredOptionIds: z.array(stableKeySchema).min(1).max(20),
          })
          .strict(),
      })
      .strict(),
    z
      .object({
        ...practiceGenerationBase,
        type: z.literal("true_false"),
        mode: z.literal("evidence_bearing"),
        answerCriteria: z
          .object({
            kind: z.literal("boolean"),
            expected: z.boolean(),
          })
          .strict(),
      })
      .strict(),
    z
      .object({
        ...practiceGenerationBase,
        type: z.literal("numeric"),
        mode: z.literal("evidence_bearing"),
        answerCriteria: z
          .object({
            kind: z.literal("numeric"),
            expected: z.number().finite(),
            absoluteTolerance: z.number().finite().nonnegative(),
            unit: z.string().trim().min(1).max(80).nullable().default(null),
          })
          .strict(),
      })
      .strict(),
    z
      .object({
        ...practiceGenerationBase,
        type: z.literal("short_answer"),
        mode: z.literal("evidence_bearing"),
        answerCriteria: z
          .object({
            kind: z.literal("keywords"),
            required: z.array(z.string().trim().min(1).max(200)).min(1).max(50),
            optional: z
              .array(z.string().trim().min(1).max(200))
              .max(50)
              .default([]),
          })
          .strict(),
      })
      .strict(),
    ...(["long_answer", "proof", "open_design"] as const).map((type) =>
      z
        .object({
          ...practiceGenerationBase,
          type: z.literal(type),
          mode: z.literal("feedback_only"),
          answerCriteria: z
            .object({
              kind: z.literal("rubric"),
              criteria: z
                .array(
                  z
                    .object({
                      label: z.string().trim().min(1).max(160),
                      description: z.string().trim().min(1).max(1_000),
                      weight: z.number().finite().positive(),
                    })
                    .strict()
                )
                .min(1)
                .max(20),
            })
            .strict(),
        })
        .strict()
    ),
  ])
  .superRefine((value, context) => {
    if (
      value.mode === "evidence_bearing" &&
      value.sourceHandles.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["sourceHandles"],
        message: "Evidence-bearing practice items require a source handle.",
      });
    }

    if ("options" in value) {
      const optionIds = value.options.map((option) => option.id);
      if (new Set(optionIds).size !== optionIds.length) {
        context.addIssue({
          code: "custom",
          path: ["options"],
          message: "Option IDs must be unique.",
        });
      }
      const requiredIds =
        value.answerCriteria.kind === "single_choice"
          ? [value.answerCriteria.selectedOptionId]
          : value.answerCriteria.requiredOptionIds;
      if (
        new Set(requiredIds).size !== requiredIds.length ||
        requiredIds.some((id) => !optionIds.includes(id))
      ) {
        context.addIssue({
          code: "custom",
          path: ["answerCriteria"],
          message: "Answer option IDs must be unique members of options.",
        });
      }
    }

    if (value.answerCriteria.kind === "rubric") {
      const total = value.answerCriteria.criteria.reduce(
        (sum, criterion) => sum + criterion.weight,
        0
      );
      if (Math.abs(total - 1) > 0.000_001) {
        context.addIssue({
          code: "custom",
          path: ["answerCriteria", "criteria"],
          message: "Rubric weights must sum to 1.",
        });
      }
    }
  });

const attemptAnswerSchema = z.union([
  z.string().max(40_000),
  z.number().finite(),
  z.boolean(),
  z.array(z.union([z.string().max(4_000), z.number().finite(), z.boolean()])).max(200),
  z.record(
    z.string().min(1).max(160),
    z.union([
      z.string().max(4_000),
      z.number().finite(),
      z.boolean(),
      z.array(z.string().max(1_000)).max(100),
    ])
  ),
]);

export const practiceAttemptSubmissionSchema = z
  .object({
    idempotencyKey: z.string().trim().min(1).max(200),
    answer: attemptAnswerSchema,
  })
  .strict();

export const attemptEvaluationGenerationSchema = z
  .object({
    verdict: evaluationVerdictSchema,
    score: z.number().finite().min(0).max(1).nullable(),
    rubric: z.record(z.string().min(1).max(160), z.unknown()).nullable(),
    confidence: z.number().finite().min(0).max(1),
    errorType: z.string().trim().min(1).max(120).nullable(),
    reason: z.string().trim().min(1).max(4_000),
  })
  .strict();
