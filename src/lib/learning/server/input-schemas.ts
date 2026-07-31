import { z } from "zod";

import {
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
