import { z } from "zod";

import {
  EVALUATION_VERDICTS,
  LEARNING_ERROR_TYPES,
  LEARNING_GOAL_STATUSES,
} from "@/lib/learning/contracts";

export const idempotentGenerationSchema = z
  .object({
    idempotencyKey: z.string().trim().min(1).max(200),
  })
  .strict();

export const goalStatusCommandSchema = z
  .object({
    status: z.enum(LEARNING_GOAL_STATUSES),
    idempotencyKey: z.string().trim().min(1).max(200),
  })
  .strict();

export const scopeCommandSchema = z.discriminatedUnion("command", [
  z
    .object({
      command: z.literal("replace_draft"),
      expectedVersion: z.number().int().nonnegative(),
      definition: z.record(z.string().min(1).max(120), z.unknown()),
      materialMode: z.enum(["project_corpus", "selected_files"]),
      fileIds: z.array(z.string().trim().min(1)).max(500),
      materialGaps: z
        .array(z.string().trim().min(1).max(500))
        .max(100)
        .default([]),
      idempotencyKey: z.string().trim().min(1).max(200),
    })
    .strict(),
  z
    .object({
      command: z.literal("confirm"),
      expectedVersion: z.number().int().positive(),
      idempotencyKey: z.string().trim().min(1).max(200),
    })
    .strict(),
]);

export const interactionCommandSchema = z
  .object({
    idempotencyKey: z.string().trim().min(1).max(200),
  })
  .strict();

export const reviewSessionCommandSchema = z
  .object({
    idempotencyKey: z.string().trim().min(1).max(200),
    limit: z.number().int().min(1).max(50).default(10),
  })
  .strict();

export const errorTypeCorrectionCommandSchema = z
  .object({
    errorType: z.enum(LEARNING_ERROR_TYPES),
    reason: z.string().trim().min(1).max(500).nullable().optional(),
    idempotencyKey: z.string().trim().min(1).max(200),
  })
  .strict();

export const regradeCommandSchema = z
  .object({
    verdict: z.enum(EVALUATION_VERDICTS),
    errorType: z.enum(LEARNING_ERROR_TYPES).nullable().optional(),
    reason: z.string().trim().min(1).max(1000),
    idempotencyKey: z.string().trim().min(1).max(200),
  })
  .strict();

export const goalRevisionCommandSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    purpose: z.string().trim().max(2000).nullable().optional(),
    targetDate: z.string().datetime().nullable().optional(),
    dailyMinutes: z.number().int().min(1).max(1440).nullable().optional(),
    reason: z.string().trim().min(1).max(500),
    idempotencyKey: z.string().trim().min(1).max(200),
  })
  .strict();

export const profileResetCommandSchema = z
  .object({
    scope: z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("user"),
        goalId: z.undefined().optional(),
        lineageId: z.undefined().optional(),
      }).strict(),
      z.object({
        kind: z.literal("goal"),
        goalId: z.string().trim().min(1),
        lineageId: z.undefined().optional(),
      }).strict(),
      z.object({
        kind: z.literal("point"),
        goalId: z.string().trim().min(1),
        lineageId: z.string().trim().min(1),
      }).strict(),
    ]),
    reason: z.string().trim().min(1).max(500).optional(),
    idempotencyKey: z.string().trim().min(1).max(200),
  })
  .strict();
