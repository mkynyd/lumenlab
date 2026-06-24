/**
 * 审计日志写入
 *
 * MVP 只做 best-effort 写入；写入失败不阻塞主流程，但会记到服务端 logger。
 */

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

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
    | "user_rejected";
  severity: "info" | "warn" | "error";
  payload: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
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
        payload: event.payload,
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