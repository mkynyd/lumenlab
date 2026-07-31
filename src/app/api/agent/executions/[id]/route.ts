import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { PrismaAgentExecutionStore } from "@/lib/agent/executions/prisma-agent-execution-store";
import { toPublicAgentExecutionRecord } from "@/lib/agent/executions/execution-public";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const { id } = await params;
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
