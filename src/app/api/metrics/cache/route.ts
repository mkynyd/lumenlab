import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getCacheMetrics,
  getExportCacheMetrics,
  getTokenUsageMetrics,
} from "@/lib/cache/api-cache-metrics";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const requestedDays = Number(
    new URL(request.url).searchParams.get("days") || 7
  );
  const days = Number.isFinite(requestedDays)
    ? Math.min(90, Math.max(1, Math.floor(requestedDays)))
    : 7;
  const [metrics, tokenUsage, exports] = await Promise.all([
    getCacheMetrics(session.user.id, days),
    getTokenUsageMetrics(session.user.id, days),
    getExportCacheMetrics(),
  ]);

  return NextResponse.json({ days, ...metrics, tokenUsage, exports });
}
