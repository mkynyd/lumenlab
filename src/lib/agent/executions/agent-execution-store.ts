import type { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import { ALL_CHAT_MODELS, LEGACY_CHAT_MODELS } from "@/lib/chat/model-catalog";
import type { AgentExecutionErrorCode } from "./contracts";

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

const checkpointContentPartSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }).strict(),
  z
    .object({
      type: z.literal("file"),
      fileAssetId: z.string().min(1),
      contentFingerprint: z.string().min(1),
    })
    .strict(),
  // 任务 08.7：消息附件（或显式引用的项目文件）资源引用。只保存平台资源 ID
  // 与版本定位，不保存签名 URL 或字节；恢复时按当前用户重新鉴权读取。
  z
    .object({
      type: z.literal("media_ref"),
      refId: z.string().min(1),
      source: z.enum(["message-attachment", "project-file"]),
      contentHash: z.string().min(1),
      mimeType: z.string().min(1),
      name: z.string().min(1),
    })
    .strict(),
]);

const checkpointItemSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("message"),
      role: z.enum(["system", "user", "assistant"]),
      content: z.array(checkpointContentPartSchema).max(256),
    })
    .strict(),
  z
    .object({
      type: z.literal("function_call"),
      callId: z.string().min(1),
      name: z.string().min(1),
      arguments: z.record(z.string(), z.unknown()),
    })
    .strict(),
  z
    .object({
      type: z.literal("function_call_output"),
      callId: z.string().min(1),
      toolExecutionId: z.string().min(1),
      status: z.enum(["succeeded", "failed", "blocked", "rejected", "unknown"]),
      output: z.string(),
    })
    .strict(),
]);

const durableRequestSchema = z
  .object({
    message: z.string().min(1).max(200_000),
    hiddenPrompt: z.string().min(1).max(200_000).optional(),
    // 活跃模型 + 历史别名：存量 v1 checkpoint 里可能是历史 ID，
    // 需要能解析恢复；新请求由 sendMessageSchema 限定为活跃模型。
    model: z.enum([...ALL_CHAT_MODELS, ...LEGACY_CHAT_MODELS]),
    thinkingEnabled: z.boolean(),
    reasoningEffort: z.enum(["high", "max"]),
    webSearchActive: z.boolean(),
    manualSkillId: z.string().min(1).optional(),
    skillOff: z.boolean(),
    mode: z
      .enum(["experiment", "review", "coding", "general"])
      .optional(),
    isQuickTask: z.boolean(),
    materialScope: z.enum(["project-corpus", "none"]).optional(),
    executionKind: z.enum(["chat", "research", "paper-formatting"]).optional(),
    researchRunId: z.string().min(1).optional(),
    formattingTaskId: z.string().min(1).optional(),
  })
  .strict();

const providerPrivateCheckpointKey =
  /(auth|bearer|cookie|token|provider.*(?:resume|continuation|handle)|(?:api|access|refresh)[_-]?key|credential|secret|password|private.*key)/i;

const checkpointUsageCounterKeys = new Set([
  "promptTokens",
  "completionTokens",
  "totalTokens",
  "promptCacheHitTokens",
  "promptCacheMissTokens",
]);

function isCheckpointUsageCounterKey(
  path: readonly string[],
  key: string
): boolean {
  return (
    ((path.length === 1 && path[0] === "usage") ||
      (path.length === 1 && path[0] === "researchState") ||
      (path.length === 2 &&
        (path[0] === "output" || path[0] === "partialOutput") &&
        path[1] === "usage")) &&
    checkpointUsageCounterKeys.has(key)
  );
}

export const MAX_AGENT_CHECKPOINT_BYTES = 2_000_000;

function isJsonSerializableCheckpointValue(
  value: unknown,
  ancestors = new WeakSet<object>(),
  path: readonly string[] = []
): boolean {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;

  if (ancestors.has(value)) return false;
  ancestors.add(value);
  if (Array.isArray(value)) {
    const valid = value.every((nested, index) =>
      isJsonSerializableCheckpointValue(nested, ancestors, [
        ...path,
        String(index),
      ])
    );
    ancestors.delete(value);
    return valid;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const valid = Object.entries(value as Record<string, unknown>).every(
    ([key, nested]) =>
      (!providerPrivateCheckpointKey.test(key) ||
        isCheckpointUsageCounterKey(path, key)) &&
      isJsonSerializableCheckpointValue(nested, ancestors, [...path, key])
  );
  ancestors.delete(value);
  return valid;
}

const checkpointUsageSchema = z
  .object({
    promptTokens: z.number().int().nonnegative(),
    completionTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
    promptCacheHitTokens: z.number().int().nonnegative().optional(),
    promptCacheMissTokens: z.number().int().nonnegative().optional(),
  })
  .strict();

const researchStateSchema = z
  .object({
    stage: z.enum([
      "planning",
      "researching",
      "evaluating",
      "citation_expansion",
      "claim_extraction",
      "synthesizing",
      "verifying",
    ]),
    modelCalls: z.number().int().nonnegative(),
    searchCalls: z.number().int().nonnegative(),
    fetchCalls: z.number().int().nonnegative(),
    sourceCount: z.number().int().nonnegative(),
    replanCount: z.number().int().nonnegative(),
    verificationRepairs: z.number().int().nonnegative(),
    promptTokens: z.number().int().nonnegative().optional(),
    completionTokens: z.number().int().nonnegative().optional(),
    totalTokens: z.number().int().nonnegative().optional(),
    costCredits: z.number().int().nonnegative().optional(),
    draftReport: z.string().max(200_000).optional(),
    lastEvidenceCount: z.number().int().nonnegative().optional(),
    claimExtraction: z
      .object({
        fingerprints: z.record(z.string(), z.string()),
      })
      .strict()
      .optional(),
    citationExpansion: z
      .object({
        done: z.boolean(),
        completedQuestionIds: z.array(z.string()),
        fingerprints: z.record(z.string(), z.array(z.string())),
        graphToolCalls: z.number().int().nonnegative(),
        metrics: z.record(z.string(), z.number().int().nonnegative()),
      })
      .strict()
      .optional(),
  })
  .strict();

const checkpointBaseSchema = z.object({
  round: z.number().int().nonnegative(),
  model: z
    .object({
      provider: z.string().min(1),
      name: z.string().min(1),
    })
    .strict(),
  skill: z
    .object({
      id: z.string().min(1).nullable(),
      version: z.string().min(1).nullable(),
    })
    .strict(),
  rag: z
    .object({
      sourceIds: z.array(z.string().min(1)),
      selectedFileIds: z.array(z.string().min(1)).default([]),
    })
    .strict(),
  allowedToolIds: z.array(z.string().min(1)),
  request: durableRequestSchema.optional(),
  researchState: researchStateSchema.optional(),
  usage: checkpointUsageSchema.optional(),
  output: z
    .object({
      text: z.string(),
      reasoning: z.string(),
      usage: checkpointUsageSchema.nullable(),
    })
    .strict()
    .optional(),
});

const agentCheckpointV1Schema = checkpointBaseSchema
  .extend({
    version: z.literal(1),
    messages: z.array(normalizedMessageSchema),
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

const agentCheckpointV2Schema = checkpointBaseSchema
  .extend({
    version: z.literal(2),
    items: z.array(checkpointItemSchema).max(2_000),
    partialOutput: z
      .object({
        text: z.string(),
        reasoning: z.string(),
        usage: checkpointUsageSchema.nullable(),
      })
      .strict()
      .optional(),
    pendingToolCall: z
      .object({
        callId: z.string().min(1),
        toolExecutionId: z.string().min(1),
        toolId: z.string().min(1),
        arguments: z.record(z.string(), z.unknown()),
      })
      .strict()
      .optional(),
  })
  .strict();

export const agentCheckpointSchema = z.discriminatedUnion("version", [
  agentCheckpointV1Schema,
  agentCheckpointV2Schema,
]);

export type AgentCheckpoint = z.infer<typeof agentCheckpointSchema>;
export type AgentCheckpointV2 = z.infer<typeof agentCheckpointV2Schema>;
export type AgentCheckpointItem = z.infer<typeof checkpointItemSchema>;

export function parseAgentCheckpoint(value: unknown): AgentCheckpoint {
  const parsed = agentCheckpointSchema.safeParse(value);
  if (!parsed.success || !isJsonSerializableCheckpointValue(parsed.data)) {
    throw new Error("Agent checkpoint is invalid");
  }
  const serialized = JSON.stringify(parsed.data);
  if (Buffer.byteLength(serialized, "utf8") > MAX_AGENT_CHECKPOINT_BYTES) {
    throw new Error("Agent checkpoint is invalid");
  }
  return parsed.data;
}

export type AgentExecutionRecord = {
  id: string;
  userId: string;
  clientRunKey: string | null;
  requestHash: string | null;
  userMessageId: string | null;
  assistantMessageId: string | null;
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

export class AgentExecutionStoreError extends Error {
  constructor(
    public readonly code: AgentExecutionErrorCode,
    message: string
  ) {
    super(message);
    this.name = "AgentExecutionStoreError";
  }
}

export type CreateOrGetAgentExecutionInput = {
  userId: string;
  clientRunKey: string;
  requestHash: string;
  conversation: {
    id?: string;
    projectId?: string | null;
    title: string;
    model: string;
    thinkingEnabled: boolean;
    kind?: "chat" | "research-system" | "paper-system";
  };
  userMessageContent: string;
  assistantMessageSources?: Prisma.InputJsonValue;
  checkpoint: AgentCheckpoint;
  scheduledAt?: Date;
};

export type CreateOrGetAgentExecutionResult = {
  execution: AgentExecutionRecord;
  created: boolean;
};

export interface AgentExecutionStore {
  create(input: {
    userId: string;
    conversationId: string;
    projectId?: string | null;
    checkpoint: AgentCheckpoint;
    scheduledAt?: Date;
  }): Promise<AgentExecutionRecord>;
  createOrGetByClientRunKey(
    input: CreateOrGetAgentExecutionInput
  ): Promise<CreateOrGetAgentExecutionResult>;
  getOwnedExecution(input: {
    executionId: string;
    userId: string;
  }): Promise<AgentExecutionRecord | null>;
  listEventsAfter(input: {
    executionId: string;
    userId: string;
    afterSequence: number;
    limit?: number;
  }): Promise<AgentExecutionEventRecord[] | null>;
  claimNext(input: {
    workerId: string;
    now: Date;
    leaseMs: number;
  }): Promise<AgentExecutionRecord | null>;
  recoverExpired(input: {
    now: Date;
    maxAttempts?: number;
    retryDelayMs?: (attempt: number) => number;
  }): Promise<number>;
  renewLease(input: {
    executionId: string;
    workerId: string;
    now: Date;
    leaseMs: number;
  }): Promise<boolean>;
  saveCheckpoint(input: {
    executionId: string;
    workerId: string;
    checkpoint: AgentCheckpoint;
    now: Date;
  }): Promise<boolean>;
  markCompleted(input: {
    executionId: string;
    workerId: string;
    now: Date;
    checkpoint?: AgentCheckpoint;
  }): Promise<boolean>;
  markFailed(input: {
    executionId: string;
    workerId: string;
    failure: Prisma.InputJsonValue;
    now: Date;
    checkpoint?: AgentCheckpoint;
  }): Promise<boolean>;
  markCancelled(input: {
    executionId: string;
    workerId: string;
    failure?: Prisma.InputJsonValue;
    now: Date;
    checkpoint?: AgentCheckpoint;
  }): Promise<boolean>;
  scheduleRetry(input: {
    executionId: string;
    workerId: string;
    failure: Prisma.InputJsonValue;
    scheduledAt: Date;
    now: Date;
    checkpoint?: AgentCheckpoint;
  }): Promise<boolean>;
  requeue(input: {
    executionId: string;
    workerId: string;
    checkpoint: AgentCheckpoint;
    scheduledAt: Date;
    now: Date;
  }): Promise<boolean>;
  resumeOwned(input: {
    executionId: string;
    userId: string;
    scheduledAt: Date;
    now: Date;
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
  expireWaitingApproval(input: {
    executionId: string;
    toolExecutionId: string;
    now: Date;
  }): Promise<boolean>;
  cancelOwned(input: {
    executionId: string;
    userId: string;
    now: Date;
  }): Promise<boolean>;
  retryOwned(input: {
    executionId: string;
    userId: string;
    now: Date;
    maxAttempts?: number;
  }): Promise<boolean>;
  reconcileWaitingApprovals(input: {
    now: Date;
    limit?: number;
  }): Promise<number>;
  appendEvent(input: {
    executionId: string;
    workerId: string;
    key: string;
    type: string;
    payload?: Prisma.InputJsonValue;
    now: Date;
  }): Promise<AgentExecutionEventRecord>;
}
