import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAgentRunMetrics } from "@/lib/agent/observability/agent-run-metrics-store";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const rawDays = Number(new URL(request.url).searchParams.get("days") || 7);
  const days = Number.isFinite(rawDays) ? rawDays : 7;
  return NextResponse.json(await getAgentRunMetrics(session.user.id, days));
}
