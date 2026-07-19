/**
 * 审计日志写入
 *
 * MVP 只做 best-effort 写入；写入失败不阻塞主流程，但会记到服务端 logger。
 */

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { Prisma } from "@/generated/prisma/client";

export interface AgentAuditPayload {
  userId: string;
  conversationId?: string;
  toolExecutionId?: string;
  skillId?: string;
  toolId?: string;
  eventType:
    | "tool_proposed"
    | "tool_blocked"
    | "approval_required"
    | "approval_granted"
    | "approval_denied"
    | "approval_expired"
    | "tool_started"
    | "tool_completed"
    | "tool_failed"
    | "token_consumed"
    | "user_rejected"
    | "agent_run_finished";
  severity: "info" | "warn" | "error";
  payload: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
}

/**
 * Audit rows are diagnostic breadcrumbs, not a second copy of user material.
 * Preserve only event lifecycle facts and allowlisted aggregate metrics.
 */
export function sanitizeAuditPayload(input: Pick<AgentAuditPayload, "eventType" | "payload">): Record<string, unknown> {
  const payload = input.payload;
  switch (input.eventType) {
    case "tool_proposed":
      return { riskLevel: stringValue(payload.riskLevel) };
    case "tool_blocked":
      return { reasonCode: stringValue(payload.reasonCode) ?? stringValue(payload.code) };
    case "approval_required":
      return { expiresAt: stringValue(payload.expiresAt) };
    case "approval_granted":
      return {
        scope: stringValue(payload.scope),
        riskLevel: stringValue(payload.riskLevel),
      };
    case "approval_denied":
    case "approval_expired":
    case "user_rejected":
      return { outcome: "rejected" };
    case "tool_started":
      return { approved: payload.approved === true };
    case "tool_completed":
      return { outcome: "succeeded" };
    case "tool_failed":
      return { code: stringValue(payload.code) ?? "TOOL_FAILED" };
    case "token_consumed":
      return { consumed: true };
    case "agent_run_finished":
      return sanitizeRunMetric(payload);
  }
}

export async function recordAuditEvent(event: AgentAuditPayload): Promise<void> {
  try {
    await prisma.agentAuditLog.create({
      data: {
        userId: event.userId,
        conversationId: event.conversationId ?? null,
        toolExecutionId: event.toolExecutionId ?? null,
        skillId: event.skillId ?? null,
        toolId: event.toolId ?? null,
        eventType: event.eventType,
        severity: event.severity,
        payload: sanitizeAuditPayload(event) as Prisma.InputJsonValue,
        ip: event.ip ?? null,
        userAgent: event.userAgent ?? null,
      },
    });
  } catch (error) {
    logger.error("audit log write failed", {
      error: String(error),
      eventType: event.eventType,
    });
  }
}

function sanitizeRunMetric(payload: Record<string, unknown>): Record<string, unknown> {
  const number = (key: string) => nonNegativeNumber(payload[key]);
  const tool = asRecord(payload.tool);
  return {
    runId: stringValue(payload.runId),
    status: stringValue(payload.status),
    success: payload.success === true,
    provider: stringValue(payload.provider),
    model: stringValue(payload.model),
    totalDurationMs: number("totalDurationMs"),
    firstTokenMs: payload.firstTokenMs === null ? null : number("firstTokenMs"),
    approvalWaitRatio:
      payload.approvalWaitRatio === null ? null : unitNumber(payload.approvalWaitRatio),
    approvalsRequested: number("approvalsRequested"),
    approvalExecutionIds: stringList(payload.approvalExecutionIds),
    autoRecoveryAttempted: payload.autoRecoveryAttempted === true,
    autoRecoverySucceeded: payload.autoRecoverySucceeded === true,
    retryCount: number("retryCount"),
    cancelled: payload.cancelled === true,
    tool: {
      proposed: nonNegativeNumber(tool.proposed),
      succeeded: nonNegativeNumber(tool.succeeded),
      failed: nonNegativeNumber(tool.failed),
    },
    retrievalHit: payload.retrievalHit === true,
    retrievedSourceCount: number("retrievedSourceCount"),
    estimatedCredits: number("estimatedCredits"),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.slice(0, 120) : null;
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").slice(0, 20)
    : [];
}

function nonNegativeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function unitNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : null;
}
