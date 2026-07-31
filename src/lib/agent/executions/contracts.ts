import { z } from "zod";

export const AGENT_EXECUTION_ERROR_CODES = [
  "execution_not_found",
  "idempotency_key_reused",
  "conversation_execution_in_progress",
  "execution_not_retryable",
  "execution_lease_lost",
] as const;

export type AgentExecutionErrorCode =
  (typeof AGENT_EXECUTION_ERROR_CODES)[number];

export const AGENT_EXECUTION_STATUSES = [
  "queued",
  "running",
  "waiting_approval",
  "completed",
  "failed",
  "cancelled",
] as const;

export type AgentExecutionStatus =
  (typeof AGENT_EXECUTION_STATUSES)[number];

export const TERMINAL_AGENT_EXECUTION_STATUSES = [
  "completed",
  "failed",
  "cancelled",
] as const satisfies readonly AgentExecutionStatus[];

export interface PublicAgentExecutionDto {
  id: string;
  conversationId: string;
  projectId: string | null;
  status: AgentExecutionStatus;
  lastEventSequence: number;
  attempt: number;
  scheduledAt: string;
  createdAt: string;
  updatedAt: string;
  failureCode: string | null;
}

export interface PrivateAgentExecutionDto extends PublicAgentExecutionDto {
  checkpoint: unknown;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  requestHash: string | null;
}

export function toPublicAgentExecution(
  execution: PrivateAgentExecutionDto
): PublicAgentExecutionDto {
  return {
    id: execution.id,
    conversationId: execution.conversationId,
    projectId: execution.projectId,
    status: execution.status,
    lastEventSequence: execution.lastEventSequence,
    attempt: execution.attempt,
    scheduledAt: execution.scheduledAt,
    createdAt: execution.createdAt,
    updatedAt: execution.updatedAt,
    failureCode: execution.failureCode,
  };
}

export const durableApprovalEventPayloadSchema = z
  .object({
    toolExecutionId: z.string().trim().min(1),
    toolId: z.string().trim().min(1).max(160),
    preview: z.record(z.string().min(1).max(160), z.unknown()),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type DurableApprovalEventPayload = z.infer<
  typeof durableApprovalEventPayloadSchema
>;
