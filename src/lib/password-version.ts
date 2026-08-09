/**
 * 密码版本查询（passwordChangedAt 的 epoch ms）。
 *
 * Redis 60s 缓存（key `pwchg:<userId>`），miss 时查 PG 回填；
 * Redis 不可用时降级直查 PG。仅限 Node runtime（auth.ts 实例使用，
 * proxy Edge 分支不调用）。
 */

import "server-only";
import { getRedis } from "@/lib/redis";
import { prisma } from "@/lib/db";

const CACHE_TTL_SECONDS = 60;

/** 密码变更后调用：删除 Redis 缓存，避免旧 pwchg 残留导致旧会话多活 60s */
export async function invalidatePasswordChangedAtCache(
  userId: string
): Promise<void> {
  try {
    await getRedis().del(`pwchg:${userId}`);
  } catch {
    // Redis 不可用：缓存本来就没写入，无需处理
  }
}

/** 返回 null 表示用户不存在（或从未设置过 passwordChangedAt） */
export async function getPasswordChangedAt(
  userId: string
): Promise<number | null> {
  try {
    const redis = getRedis();
    const cached = await redis.get(`pwchg:${userId}`);
    if (cached !== null) {
      return cached === "" ? null : Number(cached);
    }
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { passwordChangedAt: true },
    });
    const value = user?.passwordChangedAt?.getTime() ?? null;
    await redis.set(
      `pwchg:${userId}`,
      value === null ? "" : String(value),
      "EX",
      CACHE_TTL_SECONDS
    );
    return value;
  } catch {
    // Redis 不可用：降级直查 PG，不做缓存
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { passwordChangedAt: true },
    });
    return user?.passwordChangedAt?.getTime() ?? null;
  }
}
