import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { PrismaAgentExecutionStore } from "@/lib/agent/executions/prisma-agent-execution-store";
import { toPublicAgentExecutionRecord } from "@/lib/agent/executions/execution-public";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const { id } = await params;
  if (new URL(request.url).searchParams.get("view") === "status") {
    const execution = await prisma.agentExecution.findFirst({
      where: { id, userId: session.user.id },
      select: { status: true },
    });
    return execution
      ? NextResponse.json(execution, { headers: { "Cache-Control": "no-store" } })
      : NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }
  const execution = await new PrismaAgentExecutionStore().getOwnedExecution({
    executionId: id,
    userId: session.user.id,
  });
  if (!execution) {
    return NextResponse.json({ error: "AgentExecution 不存在" }, { status: 404 });
  }
  return NextResponse.json({
    execution: toPublicAgentExecutionRecord(execution),
  });
}
