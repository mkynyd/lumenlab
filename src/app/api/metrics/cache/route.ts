import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getCacheMetrics,
  getExportCacheMetrics,
  getRagCacheMetrics,
  getTokenUsageMetrics,
} from "@/lib/cache/api-cache-metrics";

function parseDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const searchParams = new URL(request.url).searchParams;
  const start = parseDate(searchParams.get("start"));
  const end = parseDate(searchParams.get("end"));
  const range = start && end ? { start, end } : undefined;

  const requestedDays = Number(searchParams.get("days") || 7);
  const days = Number.isFinite(requestedDays)
    ? Math.min(90, Math.max(1, Math.floor(requestedDays)))
    : 7;

  const [metrics, tokenUsage, exports, rag] = await Promise.all([
    getCacheMetrics(session.user.id, range ?? days),
    getTokenUsageMetrics(session.user.id, range ?? days),
    getExportCacheMetrics(),
    getRagCacheMetrics(),
  ]);

  return NextResponse.json({ days, ...metrics, tokenUsage, exports, rag });
}
