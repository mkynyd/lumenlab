import type { Prisma } from "@/generated/prisma/client";
import { z } from "zod";

export const AGENT_EXECUTION_STATUSES = [
  "queued",
  "running",
  "waiting_approval",
  "completed",
  "failed",
  "cancelled",
] as const;

export type AgentExecutionStatus = (typeof AGENT_EXECUTION_STATUSES)[number];

const normalizedMessageSchema = z
  .object({
    role: z.enum(["system", "user", "assistant", "tool"]),
    content: z.string(),
  })
  .strict();

const providerPrivateCheckpointKey =
  /(auth|bearer|cookie|token|provider.*(?:resume|continuation|handle)|(?:api|access|refresh)[_-]?key|credential|secret|password|private.*key)/i;

function isJsonSerializableCheckpointValue(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) {
    return value.every(isJsonSerializableCheckpointValue);
  }
  if (typeof value !== "object") return false;

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.entries(value as Record<string, unknown>).every(
    ([key, nested]) =>
      !providerPrivateCheckpointKey.test(key) &&
      isJsonSerializableCheckpointValue(nested)
  );
}

export const agentCheckpointSchema = z
  .object({
    version: z.literal(1),
    messages: z.array(normalizedMessageSchema),
    round: z.number().int().nonnegative(),
    model: z.object({ provider: z.string().min(1), name: z.string().min(1) }).strict(),
    skill: z.object({ id: z.string().min(1).nullable(), version: z.string().min(1).nullable() }).strict(),
    rag: z.object({ sourceIds: z.array(z.string().min(1)), selectedFileIds: z.array(z.string().min(1)).default([]) }).strict(),
    allowedToolIds: z.array(z.string().min(1)),
    pendingToolCall: z
      .object({
        id: z.string().min(1),
        toolId: z.string().min(1),
        arguments: z.record(z.string(), z.unknown()),
      })
      .strict()
      .optional(),
  })
  .strict();

export type AgentCheckpoint = z.infer<typeof agentCheckpointSchema>;

export function parseAgentCheckpoint(value: unknown): AgentCheckpoint {
  const parsed = agentCheckpointSchema.safeParse(value);
  if (
    !parsed.success ||
    (parsed.data.pendingToolCall !== undefined &&
      !isJsonSerializableCheckpointValue(parsed.data.pendingToolCall.arguments))
  ) {
    throw new Error("Agent checkpoint is invalid");
  }
  return parsed.data;
}

export type AgentExecutionRecord = {
  id: string;
  userId: string;
  conversationId: string;
  projectId: string | null;
  status: AgentExecutionStatus;
  checkpoint: AgentCheckpoint | null;
  waitingToolExecutionId: string | null;
  scheduledAt: Date;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  attempt: number;
  lastEventSequence: number;
  failure: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AgentExecutionEventRecord = {
  id: string;
  executionId: string;
  sequence: number;
  key: string;
  type: string;
  payload: Prisma.JsonValue | null;
  createdAt: Date;
};

export interface AgentExecutionStore {
  create(input: {
    userId: string;
    conversationId: string;
    projectId?: string | null;
    checkpoint: AgentCheckpoint;
    scheduledAt?: Date;
  }): Promise<AgentExecutionRecord>;
  claimNext(input: {
    workerId: string;
    now: Date;
    leaseMs: number;
  }): Promise<AgentExecutionRecord | null>;
  recoverExpired(input: { now: Date }): Promise<number>;
  renewLease(input: {
    executionId: string;
    workerId: string;
    now: Date;
    leaseMs: number;
  }): Promise<boolean>;
  markWaitingForApproval(input: {
    executionId: string;
    workerId: string;
    toolExecutionId: string;
    checkpoint: AgentCheckpoint;
    now: Date;
  }): Promise<boolean>;
  enqueueAfterApproval(input: {
    executionId: string;
    toolExecutionId: string;
    now: Date;
  }): Promise<boolean>;
  appendEvent(input: {
    executionId: string;
    key: string;
    type: string;
    payload?: Prisma.InputJsonValue;
    now?: Date;
  }): Promise<AgentExecutionEventRecord>;
}
