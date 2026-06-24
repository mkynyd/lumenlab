/**
 * 一次性审批 token 兑换
 *
 * POST /api/agent/approve
 * Body: { token: string, executionId: string, arguments: Record<string, unknown> }
 *
 * 服务端再次校验 token + 参数哈希一致；通过后把 ToolExecution 状态从 pending_approval
 * 切到 approved，等待 chat loop 拿到事件后继续执行。
 *
 * MVP：审批通过只标记状态，真正的"接着执行"由 chat SSE 循环在收到 approval_required
 * 后阻塞轮询 ToolExecution 状态变化，或由前端在收到 200 后通过同一 SSE 流恢复。
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { consumeApprovalToken } from "@/lib/agent/approval-token";
import { recordAuditEvent } from "@/lib/agent/audit-log";
import "@/lib/tools/registry";

interface ApproveBody {
  token: string;
  executionId: string;
  arguments: Record<string, unknown>;
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

  const result = await consumeApprovalToken(body.token, body.arguments ?? {});
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
  await prisma.toolExecution.update({
    where: { id: body.executionId },
    data: {
      status: "approved",
      approvedAt: new Date(),
      approvalScope: scope,
    },
  });

  await recordAuditEvent({
    userId,
    conversationId: execution.conversationId,
    toolExecutionId: execution.id,
    skillId: execution.skillId,
    toolId: execution.toolId,
    eventType: "approval_granted",
    severity: "info",
    payload: { scope, riskLevel: execution.riskLevel },
    ip: request.headers.get("x-forwarded-for") ?? undefined,
    userAgent: request.headers.get("user-agent") ?? undefined,
  });

  return NextResponse.json({ ok: true, scope, executionId: body.executionId });
}