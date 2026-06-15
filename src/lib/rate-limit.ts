import { randomUUID } from "node:crypto";
import { getRedis } from "@/lib/redis";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
}

interface RateLimitEntry {
  timestamps: number[];
  touchedAt: number;
}

const memoryStore = new Map<string, RateLimitEntry>();
const MAX_MEMORY_KEYS = 10_000;
let redisUnavailableUntil = 0;

const SLIDING_WINDOW_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
redis.call("ZREMRANGEBYSCORE", key, 0, now - window)
local count = redis.call("ZCARD", key)
local oldest = redis.call("ZRANGE", key, 0, 0, "WITHSCORES")
if count >= limit then
  redis.call("PEXPIRE", key, window)
  local reset = now + window
  if oldest[2] then reset = tonumber(oldest[2]) + window end
  return {0, 0, reset}
end
redis.call("ZADD", key, now, member)
count = count + 1
redis.call("PEXPIRE", key, window)
if not oldest[2] then oldest = {member, tostring(now)} end
return {1, limit - count, tonumber(oldest[2]) + window}
`;

function pruneMemory(now: number): void {
  if (memoryStore.size < MAX_MEMORY_KEYS) return;
  const oldest = [...memoryStore.entries()]
    .sort(([, left], [, right]) => left.touchedAt - right.touchedAt)
    .slice(0, Math.max(1, Math.floor(MAX_MEMORY_KEYS * 0.1)));
  for (const [key] of oldest) memoryStore.delete(key);
  for (const [key, entry] of memoryStore) {
    if (entry.timestamps.length === 0 || now - entry.touchedAt > 60 * 60_000) {
      memoryStore.delete(key);
    }
  }
}

function checkMemoryRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
  now = Date.now()
): RateLimitResult {
  pruneMemory(now);
  const threshold = now - windowMs;
  const current = memoryStore.get(key);
  const timestamps = (current?.timestamps || []).filter(
    (timestamp) => timestamp > threshold
  );

  if (timestamps.length >= maxRequests) {
    memoryStore.set(key, { timestamps, touchedAt: now });
    return {
      allowed: false,
      remaining: 0,
      resetTime: timestamps[0] + windowMs,
    };
  }

  timestamps.push(now);
  memoryStore.set(key, { timestamps, touchedAt: now });
  return {
    allowed: true,
    remaining: Math.max(0, maxRequests - timestamps.length),
    resetTime: timestamps[0] + windowMs,
  };
}

export async function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): Promise<RateLimitResult> {
  const now = Date.now();
  if (now < redisUnavailableUntil) {
    return checkMemoryRateLimit(key, maxRequests, windowMs, now);
  }

  try {
    const result = (await getRedis().eval(
      SLIDING_WINDOW_SCRIPT,
      1,
      `rate-limit:${key}`,
      now,
      windowMs,
      maxRequests,
      `${now}:${randomUUID()}`
    )) as [number, number, number];
    return {
      allowed: result[0] === 1,
      remaining: Number(result[1]),
      resetTime: Number(result[2]),
    };
  } catch {
    redisUnavailableUntil = now + 30_000;
    return checkMemoryRateLimit(key, maxRequests, windowMs, now);
  }
}

export const RateLimits = {
  LOGIN: { max: 5, window: 60_000 },
  REGISTER: { max: 3, window: 60_000 },
  CHAT: { max: 30, window: 60_000 },
  API_KEY: { max: 10, window: 60_000 },
} as const;
