import { prisma } from "@/lib/db";
import { ensureDiscovery } from "@/lib/skills/registry";
import { recordAuditEvent } from "../audit-log";
import { evaluatePolicy } from "../policy-engine";
import { PrismaToolExecutionAdapter } from "../persistence/prisma-tool-execution-adapter";
import { PrismaUserScopeAdapter } from "../persistence/prisma-user-scope-adapter";
import { skillRegistry } from "../skill-registry";
import { executeTool } from "../tool-executor";
import { toolRegistry } from "../tool-registry";
import type { AgentExecutionHandlerContext } from "./agent-execution-runner";
import type { AgentEvent } from "../types";
import "@/lib/tools/registry";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Bridges an in-flight pre-upgrade checkpoint. New tools never park for approval. */
export async function recoverLegacyTool(
  { execution, signal }: AgentExecutionHandlerContext,
  toolExecutionId: string,
): Promise<AgentEvent | null> {
  const row = await prisma.toolExecution.findFirst({
    where: {
      id: toolExecutionId,
      agentExecutionId: execution.id,
      userId: execution.userId,
      conversationId: execution.conversationId,
      status: "pending_approval",
    },
  });
  if (!row) return null;
  const persistence = new PrismaToolExecutionAdapter();
  const arguments_ = asRecord(row.normalizedArguments);
  const snapshot = asRecord(asRecord(row.auditMetadata).executionContext);
  const projectId = execution.projectId ?? undefined;
  const selectedFileIds = execution.checkpoint?.rag.selectedFileIds ?? [];
  const webSearchActive = snapshot.webSearchActive === true;
  const tool = toolRegistry.get(row.toolId);
  if (row.skillId) await ensureDiscovery();
  const skill = row.skillId ? skillRegistry.get(row.skillId) : undefined;
  const decision = tool && (!row.skillId || skill) ? await evaluatePolicy({
    user: { id: execution.userId, scopes: await new PrismaUserScopeAdapter().load(execution.userId) },
    workspace: { id: projectId ?? "default", policies: [] },
    conversation: { id: execution.conversationId, sessionApprovals: new Map() },
    skill, tool, arguments: arguments_, webSearchActive,
    resourceContext: { projectId, selectedFileIds },
  }) : null;
  signal.throwIfAborted();
  const audit = {
    userId: row.userId,
    conversationId: row.conversationId,
    toolExecutionId: row.id,
    toolId: row.toolId,
    skillId: row.skillId ?? undefined,
  };
  if (decision?.decision !== "allow") {
    const error = {
      code: decision?.reasonCode ?? "TOOL_UNAVAILABLE",
      message: decision?.sanitizedPreview.summary ?? "工具或技能已不可用",
    };
    if (!await persistence.claimPendingAsBlocked(row.id, error)) return null;
    await recordAuditEvent({ ...audit, eventType: "tool_blocked", severity: "warn", payload: error });
    return { type: "tool_blocked", executionId: row.id, reasonCode: error.code, reason: error.message };
  }
  if (!await persistence.claimApprovedExecution(row.id, { scope: "once" })) return null;
  await recordAuditEvent({ ...audit, eventType: "tool_started", severity: "info", payload: { automaticRecovery: true } });
  const outcome = await executeTool(row.toolId, {
    userId: row.userId, conversationId: row.conversationId, projectId, selectedFileIds,
    signal: AbortSignal.any([signal, AbortSignal.timeout(tool?.timeoutMs ?? 120_000)]),
  }, arguments_);
  if (outcome.ok) {
    const resultSummary = outcome.result ?? {};
    if (!await persistence.markExecutingSucceeded(row.id, resultSummary)) return null;
    await recordAuditEvent({ ...audit, eventType: "tool_completed", severity: "info", payload: { automaticRecovery: true } });
    return { type: "tool_completed", executionId: row.id, resultSummary };
  }
  const error = { code: outcome.errorCode ?? "HANDLER_ERROR", message: outcome.errorMessage ?? "工具执行失败" };
  if (!await persistence.markExecutingFailed(row.id, error)) return null;
  await recordAuditEvent({ ...audit, eventType: "tool_failed", severity: "error", payload: error });
  return { type: "tool_failed", executionId: row.id, errorCode: error.code, error: error.message };
}
