import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  getCycleEndDate,
  isQuotaEnforced,
  getRemainingCredits,
} from "@/lib/tokens";
import { getDisplayTotalTokens } from "@/lib/token-usage-display";

const MS_PER_HOUR = 60 * 60 * 1000;

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const userId = session.user.id;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      planTier: true,
      planCredits: true,
      creditsUsed: true,
      cycleStartedAt: true,
    },
  });
  if (!user) {
    return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  }

  const cycleStart = user.cycleStartedAt;
  const cycleEnd = getCycleEndDate(cycleStart);
  const now = new Date();

  const [
    currentCycleRecords,
    last24h,
    last7d,
    last5h,
    recentRecords,
  ] = await Promise.all([
    prisma.tokenUsage.findMany({
      where: { userId, createdAt: { gte: cycleStart } },
      select: {
        model: true,
        creditsConsumed: true,
        totalTokens: true,
        inputCacheHitTokens: true,
        inputCacheMissTokens: true,
        outputTokens: true,
      },
    }),
    prisma.tokenUsage.aggregate({
      _sum: { creditsConsumed: true },
      where: { userId, createdAt: { gte: new Date(now.getTime() - 24 * MS_PER_HOUR) } },
    }),
    prisma.tokenUsage.aggregate({
      _sum: { creditsConsumed: true },
      where: { userId, createdAt: { gte: new Date(now.getTime() - 7 * 24 * MS_PER_HOUR) } },
    }),
    prisma.tokenUsage.aggregate({
      _sum: { creditsConsumed: true },
      where: { userId, createdAt: { gte: new Date(now.getTime() - 5 * MS_PER_HOUR) } },
    }),
    prisma.tokenUsage.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        model: true,
        provider: true,
        totalTokens: true,
        inputCacheHitTokens: true,
        inputCacheMissTokens: true,
        outputTokens: true,
        creditsConsumed: true,
        createdAt: true,
      },
    }),
  ]);

  const currentCycleCredits = currentCycleRecords.reduce(
    (sum, record) => sum + record.creditsConsumed,
    0
  );
  const currentCycleTokens = currentCycleRecords.reduce(
    (sum, record) => sum + getDisplayTotalTokens(record),
    0
  );
  const modelDistribution = [
    ...currentCycleRecords
      .reduce((map, record) => {
        const current = map.get(record.model) || { credits: 0, tokens: 0 };
        current.credits += record.creditsConsumed;
        current.tokens += getDisplayTotalTokens(record);
        map.set(record.model, current);
        return map;
      }, new Map<string, { credits: number; tokens: number }>())
      .entries(),
  ].map(([model, values]) => ({ model, ...values }));

  return NextResponse.json({
    tier: user.planTier,
    cycle: {
      start: cycleStart.toISOString(),
      end: cycleEnd.toISOString(),
    },
    quota: {
      total: isQuotaEnforced(user.planCredits) ? user.planCredits : null,
      used: user.creditsUsed,
      remaining: getRemainingCredits(user),
      enforced: isQuotaEnforced(user.planCredits),
    },
    usage: {
      currentCycleCredits,
      currentCycleTokens,
      last24hCredits: last24h._sum.creditsConsumed ?? 0,
      last7dCredits: last7d._sum.creditsConsumed ?? 0,
      last5hCredits: last5h._sum.creditsConsumed ?? 0,
      modelDistribution,
      recentRecords: recentRecords.map((record) => ({
        id: record.id,
        model: record.model,
        provider: record.provider,
        totalTokens: getDisplayTotalTokens(record),
        creditsConsumed: record.creditsConsumed,
        createdAt: record.createdAt,
      })),
    },
  });
}
