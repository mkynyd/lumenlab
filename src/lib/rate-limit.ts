/**
 * In-memory rate limiter.
 * For production, replace with Redis-backed implementation.
 */

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const store = new Map<string, RateLimitEntry>();

// Clean expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.resetTime) {
      store.delete(key);
    }
  }
}, 5 * 60 * 1000);

/**
 * Check if a request should be rate limited.
 * @param key Unique identifier (e.g., IP + endpoint)
 * @param maxRequests Maximum allowed requests in the window
 * @param windowMs Time window in milliseconds
 * @returns true if allowed, false if rate limited
 */
export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; remaining: number; resetTime: number } {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetTime) {
    store.set(key, { count: 1, resetTime: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1, resetTime: now + windowMs };
  }

  if (entry.count >= maxRequests) {
    return { allowed: false, remaining: 0, resetTime: entry.resetTime };
  }

  entry.count++;
  return { allowed: true, remaining: maxRequests - entry.count, resetTime: entry.resetTime };
}

/**
 * Rate limit presets for different endpoints.
 */
export const RateLimits = {
  LOGIN: { max: 5, window: 60_000 },       // 5 per minute
  REGISTER: { max: 3, window: 60_000 },     // 3 per minute
  CHAT: { max: 30, window: 60_000 },        // 30 per minute per user
  API_KEY: { max: 10, window: 60_000 },     // 10 per minute
} as const;
