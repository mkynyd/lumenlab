import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { PrismaAgentExecutionStore } from "@/lib/agent/executions/prisma-agent-execution-store";
import { toPublicAgentExecutionRecord } from "@/lib/agent/executions/execution-public";
import { startAgentExecutionWorker } from "@/lib/agent/executions/durable-agent-runtime";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const { id } = await params;
  const store = new PrismaAgentExecutionStore();
  const current = await store.getOwnedExecution({
    executionId: id,
    userId: session.user.id,
  });
  if (!current) {
    return NextResponse.json({ error: "AgentExecution 不存在" }, { status: 404 });
  }
  if (!["failed", "cancelled"].includes(current.status)) {
    return NextResponse.json(
      { error: `AgentExecution 状态为 ${current.status}` },
      { status: 409 }
    );
  }
  const retried = await store.retryOwned({
    executionId: id,
    userId: session.user.id,
    now: new Date(),
  });
  if (!retried) {
    return NextResponse.json(
      { error: "AgentExecution 已达到重试上限或已被其他请求处理" },
      { status: 409 }
    );
  }
  startAgentExecutionWorker();
  const execution = await store.getOwnedExecution({
    executionId: id,
    userId: session.user.id,
  });
  return NextResponse.json({
    ok: true,
    execution: execution ? toPublicAgentExecutionRecord(execution) : null,
  });
}
