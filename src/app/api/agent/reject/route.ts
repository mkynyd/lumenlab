/**
 * 拒绝一次 ToolExecution
 *
 * POST /api/agent/reject
 * Body: { executionId: string, reason?: string }
 *
 * 把 ToolExecution 标记为 rejected，向 Agent 返回结构化拒绝，
 * Agent 循环应当继续后续步骤而不是中断整个任务。
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/agent/audit-log";

interface RejectBody {
  executionId: string;
  reason?: string;
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const userId = session.user.id;

  let body: RejectBody;
  try {
    body = (await request.json()) as RejectBody;
  } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }
  if (!body.executionId) {
    return NextResponse.json({ error: "缺少 executionId" }, { status: 400 });
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

  const claimed = await prisma.toolExecution.updateMany({
    where: {
      id: body.executionId,
      userId,
      status: "pending_approval",
    },
    data: {
      status: "rejected",
      completedAt: new Date(),
      errorSummary: { code: "USER_REJECTED", message: body.reason ?? "用户拒绝" },
    },
  });
  if (claimed.count !== 1) {
    return NextResponse.json(
      { error: "ToolExecution 已被其他请求处理" },
      { status: 409 }
    );
  }

  await recordAuditEvent({
    userId,
    conversationId: execution.conversationId,
    toolExecutionId: execution.id,
    skillId: execution.skillId ?? undefined,
    toolId: execution.toolId,
    eventType: "user_rejected",
    severity: "warn",
    payload: { reason: body.reason ?? null },
    ip: request.headers.get("x-forwarded-for") ?? undefined,
    userAgent: request.headers.get("user-agent") ?? undefined,
  });

  return NextResponse.json({ ok: true, executionId: body.executionId });
}
