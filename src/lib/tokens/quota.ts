import { prisma } from "@/lib/db";
import { calculateCredits } from "./credits";

const CYCLE_DAYS = 30;

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function getCycleEndDate(cycleStartedAt: Date): Date {
  return addDays(cycleStartedAt, CYCLE_DAYS);
}

export function shouldResetCycle(cycleStartedAt: Date): boolean {
  return new Date() >= getCycleEndDate(cycleStartedAt);
}

export function isQuotaEnforced(planCredits: number): boolean {
  // planCredits <= 0 表示 A 测期间不限制额度
  return planCredits > 0;
}

export function getRemainingCredits(user: {
  planCredits: number;
  creditsUsed: number;
}): number | null {
  if (!isQuotaEnforced(user.planCredits)) return null;
  return Math.max(0, user.planCredits - user.creditsUsed);
}

export type RecordTokenUsageInput = {
  userId: string;
  conversationId?: string;
  messageId?: string;
  model: string;
  provider: string;
  inputCacheHitTokens: number;
  inputCacheMissTokens: number;
  outputTokens: number;
  totalTokens: number;
};

/**
 * 创建 TokenUsage 记录并更新用户累计用量。
 * 若已跨周期，会自动重置 creditsUsed 和 cycleStartedAt。
 */
export async function recordTokenUsage(input: RecordTokenUsageInput) {
  const credits = calculateCredits(input.model, {
    inputCacheHitTokens: input.inputCacheHitTokens,
    inputCacheMissTokens: input.inputCacheMissTokens,
    outputTokens: input.outputTokens,
  });

  const user = await prisma.user.findUnique({
    where: { id: input.userId },
  });
  if (!user) return null;

  const resetCycle = shouldResetCycle(user.cycleStartedAt);
  const cycleStartedAt = resetCycle ? new Date() : user.cycleStartedAt;
  const creditsUsed = resetCycle ? 0 : user.creditsUsed;

  const [usage] = await prisma.$transaction([
    prisma.tokenUsage.create({
      data: {
        ...input,
        creditsConsumed: credits,
      },
    }),
    prisma.user.update({
      where: { id: input.userId },
      data: {
        cycleStartedAt,
        creditsUsed: creditsUsed + credits,
      },
    }),
  ]);

  return usage;
}

/**
 * 检查用户是否有足够额度发起新请求。
 * 返回 null 表示未启用限制（如 A 测期间）。
 */
export async function checkQuotaForRequest(
  userId: string,
  estimatedCredits: number
): Promise<{ allowed: boolean; remaining: number | null }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { planCredits: true, creditsUsed: true, cycleStartedAt: true },
  });
  if (!user) return { allowed: false, remaining: null };

  if (!isQuotaEnforced(user.planCredits)) {
    return { allowed: true, remaining: null };
  }

  if (shouldResetCycle(user.cycleStartedAt)) {
    await prisma.user.update({
      where: { id: userId },
      data: { creditsUsed: 0, cycleStartedAt: new Date() },
    });
    return { allowed: true, remaining: user.planCredits };
  }

  const remaining = user.planCredits - user.creditsUsed;
  return { allowed: remaining >= estimatedCredits, remaining };
}
