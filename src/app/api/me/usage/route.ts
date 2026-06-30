import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  getCycleEndDate,
  isQuotaEnforced,
  getRemainingCredits,
} from "@/lib/tokens";

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
    currentCycleTotal,
    last24h,
    last7d,
    last5h,
    modelDistribution,
    recentRecords,
  ] = await Promise.all([
    prisma.tokenUsage.aggregate({
      _sum: { creditsConsumed: true, totalTokens: true },
      where: { userId, createdAt: { gte: cycleStart } },
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
    prisma.tokenUsage.groupBy({
      by: ["model"],
      _sum: { creditsConsumed: true, totalTokens: true },
      where: { userId, createdAt: { gte: cycleStart } },
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
        creditsConsumed: true,
        createdAt: true,
      },
    }),
  ]);

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
      currentCycleCredits: currentCycleTotal._sum.creditsConsumed ?? 0,
      currentCycleTokens: currentCycleTotal._sum.totalTokens ?? 0,
      last24hCredits: last24h._sum.creditsConsumed ?? 0,
      last7dCredits: last7d._sum.creditsConsumed ?? 0,
      last5hCredits: last5h._sum.creditsConsumed ?? 0,
      modelDistribution: modelDistribution.map((item) => ({
        model: item.model,
        credits: item._sum.creditsConsumed ?? 0,
        tokens: item._sum.totalTokens ?? 0,
      })),
      recentRecords,
    },
  });
}
