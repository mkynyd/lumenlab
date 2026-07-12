/**
 * 一次性审批 token 兑换
 *
 * POST /api/agent/approve
 * Body: { token: string, executionId: string, scope?: "once" | "session" }
 *
 * 服务端先校验执行归属和状态，再使用落库的规范化参数校验一次性 token 的
 * user / conversation / tool / request 绑定。兑换前还会用当前 Tool/Skill 元数据、
 * 用户 scope 和资源归属重新评估策略；通过后原子抢占执行并走统一 handler、
 * persistence、audit 链，返回明确的 succeeded / failed 终态。
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { consumeApprovalToken } from "@/lib/agent/approval-token";
import { recordAuditEvent } from "@/lib/agent/audit-log";
import { executeTool } from "@/lib/agent/tool-executor";
import { PrismaToolExecutionAdapter } from "@/lib/agent/persistence/prisma-tool-execution-adapter";
import { PrismaUserScopeAdapter } from "@/lib/agent/persistence/prisma-user-scope-adapter";
import { evaluatePolicy } from "@/lib/agent/policy-engine";
import { skillRegistry } from "@/lib/agent/skill-registry";
import { toolRegistry } from "@/lib/agent/tool-registry";
import { ensureDiscovery } from "@/lib/skills/registry";
import "@/lib/tools/registry";

interface ApproveBody {
  token: string;
  executionId: string;
  scope?: "once" | "session";
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const userId = session.user.id;

  let body: ApproveBody;
  try {
    body = (await request.json()) as ApproveBody;
  } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  if (!body.token || !body.executionId) {
    return NextResponse.json({ error: "缺少必要字段" }, { status: 400 });
  }

  const execution = await prisma.toolExecution.findUnique({
    where: { id: body.executionId },
  });
  if (!execution || execution.userId !== userId) {
    return NextResponse.json({ error: "ToolExecution 不存在" }, { status: 404 });
  }
  if (execution.status !== "pending_approval") {
    return NextResponse.json(
      { error: `ToolExecution 状态为 ${execution.status}` },
      { status: 409 }
    );
  }

  const scope = body.scope ?? "once";
  if (scope !== "once" && scope !== "session") {
    return NextResponse.json({ error: "无效的批准范围" }, { status: 400 });
  }
  const normalizedArguments = asArguments(execution.normalizedArguments);
  const auditMetadata = asArguments(execution.auditMetadata);
  const executionContext = asArguments(auditMetadata.executionContext);
  const projectId =
    typeof executionContext.projectId === "string"
      ? executionContext.projectId
      : typeof normalizedArguments.projectId === "string"
        ? normalizedArguments.projectId
        : undefined;
  const selectedFileIds = Array.isArray(executionContext.selectedFileIds)
    ? executionContext.selectedFileIds.filter(
        (value): value is string => typeof value === "string"
      )
    : Array.isArray(normalizedArguments.selectedFileIds)
      ? normalizedArguments.selectedFileIds.filter(
          (value): value is string => typeof value === "string"
        )
      : undefined;
  const persistence = new PrismaToolExecutionAdapter();
  const denyCurrentPolicy = async (reasonCode: string, message: string) => {
    const claimed = await persistence.claimPendingAsBlocked(execution.id, {
      code: reasonCode,
      message,
    });
    if (!claimed) {
      return NextResponse.json(
        { ok: false, reason: "EXECUTION_ALREADY_CLAIMED" },
        { status: 409 }
      );
    }
    await recordAuditEvent({
      userId,
      conversationId: execution.conversationId,
      toolExecutionId: execution.id,
      skillId: execution.skillId ?? undefined,
      toolId: execution.toolId,
      eventType: "approval_denied",
      severity: "warn",
      payload: { reason: reasonCode, message, phase: "policy_revalidation" },
      ip: request.headers.get("x-forwarded-for") ?? undefined,
      userAgent: request.headers.get("user-agent") ?? undefined,
    });
    return NextResponse.json(
      { ok: false, reason: reasonCode },
      { status: 403 }
    );
  };

  const currentTool = toolRegistry.get(execution.toolId);
  if (!currentTool) {
    return denyCurrentPolicy("TOOL_NOT_REGISTERED", "Tool 不再可用");
  }
  if (
    scope === "session" &&
    [execution.riskLevel, currentTool.riskLevel].some(
      (riskLevel) => riskLevel === "L3" || riskLevel === "L4"
    )
  ) {
    return NextResponse.json(
      { error: "L3/L4 工具不支持会话级批准" },
      { status: 400 }
    );
  }

  let currentSkill;
  if (execution.skillId) {
    await ensureDiscovery();
    currentSkill = skillRegistry.get(execution.skillId);
    if (!currentSkill) {
      return denyCurrentPolicy("SKILL_NOT_REGISTERED", "Skill 不再可用");
    }
  }
  const currentScopes = await new PrismaUserScopeAdapter().load(userId);
  const policyDecision = await evaluatePolicy({
    user: { id: userId, scopes: currentScopes },
    workspace: { id: projectId ?? "default", policies: [] },
    conversation: {
      id: execution.conversationId,
      activeSkill:
        execution.skillId && currentSkill
          ? { skillId: execution.skillId, version: currentSkill.version }
          : undefined,
      sessionApprovals: new Map(),
    },
    skill: currentSkill,
    tool: currentTool,
    arguments: normalizedArguments,
    resourceContext: { projectId, selectedFileIds },
  });
  if (policyDecision.decision === "deny") {
    return denyCurrentPolicy(
      policyDecision.reasonCode,
      policyDecision.sanitizedPreview.summary
    );
  }

  const result = await consumeApprovalToken(body.token, normalizedArguments, {
    userId,
    conversationId: execution.conversationId,
    toolId: execution.toolId,
    requestId: execution.id,
  });
  if (!result.ok) {
    await recordAuditEvent({
      userId,
      eventType: "approval_denied",
      severity: "warn",
      payload: { reason: result.reason, executionId: body.executionId },
      ip: request.headers.get("x-forwarded-for") ?? undefined,
      userAgent: request.headers.get("user-agent") ?? undefined,
    });
    return NextResponse.json(
      { ok: false, reason: result.reason },
      { status: 400 }
    );
  }

  if (result.requestId !== body.executionId) {
    const reason = "executionId 与 token 绑定请求不一致";
    await recordAuditEvent({
      userId,
      eventType: "approval_denied",
      severity: "warn",
      payload: { reason, executionId: body.executionId, expectedRequestId: result.requestId },
      ip: request.headers.get("x-forwarded-for") ?? undefined,
      userAgent: request.headers.get("user-agent") ?? undefined,
    });
    return NextResponse.json({ ok: false, reason }, { status: 400 });
  }

  const claimedExecution = await persistence.claimApprovedExecution(
    body.executionId,
    { scope }
  );
  if (!claimedExecution) {
    await recordAuditEvent({
      userId,
      conversationId: execution.conversationId,
      toolExecutionId: execution.id,
      skillId: execution.skillId ?? undefined,
      toolId: execution.toolId,
      eventType: "approval_denied",
      severity: "warn",
      payload: { reason: "EXECUTION_ALREADY_CLAIMED" },
      ip: request.headers.get("x-forwarded-for") ?? undefined,
      userAgent: request.headers.get("user-agent") ?? undefined,
    });
    return NextResponse.json(
      { ok: false, reason: "EXECUTION_ALREADY_CLAIMED" },
      { status: 409 }
    );
  }

  await recordAuditEvent({
    userId,
    conversationId: execution.conversationId,
    toolExecutionId: execution.id,
    skillId: execution.skillId ?? undefined,
    toolId: execution.toolId,
    eventType: "approval_granted",
    severity: "info",
    payload: { scope, riskLevel: execution.riskLevel },
    ip: request.headers.get("x-forwarded-for") ?? undefined,
    userAgent: request.headers.get("user-agent") ?? undefined,
  });

  await recordAuditEvent({
    userId,
    conversationId: execution.conversationId,
    toolExecutionId: execution.id,
    skillId: execution.skillId ?? undefined,
    toolId: execution.toolId,
    eventType: "token_consumed",
    severity: "info",
    payload: { tokenRecordId: result.recordId },
    ip: request.headers.get("x-forwarded-for") ?? undefined,
    userAgent: request.headers.get("user-agent") ?? undefined,
  });

  await recordAuditEvent({
    userId,
    conversationId: execution.conversationId,
    toolExecutionId: execution.id,
    skillId: execution.skillId ?? undefined,
    toolId: execution.toolId,
    eventType: "tool_started",
    severity: "info",
    payload: { approved: true },
    ip: request.headers.get("x-forwarded-for") ?? undefined,
    userAgent: request.headers.get("user-agent") ?? undefined,
  });

  const executed = await executeTool(
    execution.toolId,
    {
      userId,
      conversationId: execution.conversationId,
      projectId,
      selectedFileIds,
      signal: request.signal,
    },
    normalizedArguments
  );

  if (!executed.ok) {
    const error = {
      code: executed.errorCode ?? "HANDLER_ERROR",
      message: executed.errorMessage ?? "工具执行失败",
    };
    await persistence.markFailed(execution.id, error);
    await recordAuditEvent({
      userId,
      conversationId: execution.conversationId,
      toolExecutionId: execution.id,
      skillId: execution.skillId ?? undefined,
      toolId: execution.toolId,
      eventType: "tool_failed",
      severity: "error",
      payload: error,
      ip: request.headers.get("x-forwarded-for") ?? undefined,
      userAgent: request.headers.get("user-agent") ?? undefined,
    });
    return NextResponse.json({
      ok: false,
      status: "failed",
      scope,
      executionId: execution.id,
      error,
    });
  }

  const resultSummary = executed.result ?? {};
  await persistence.markSucceeded(execution.id, resultSummary);
  await recordAuditEvent({
    userId,
    conversationId: execution.conversationId,
    toolExecutionId: execution.id,
    skillId: execution.skillId ?? undefined,
    toolId: execution.toolId,
    eventType: "tool_completed",
    severity: "info",
    payload: { resultSummary },
    ip: request.headers.get("x-forwarded-for") ?? undefined,
    userAgent: request.headers.get("user-agent") ?? undefined,
  });

  return NextResponse.json({
    ok: true,
    status: "succeeded",
    scope,
    executionId: execution.id,
    resultSummary,
  });
}

function asArguments(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}
