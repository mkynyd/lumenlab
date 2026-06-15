import { beforeEach, describe, expect, it, vi } from "vitest";

const redisEval = vi.fn();
const redisGet = vi.fn();

vi.mock("@/lib/redis", () => ({
  getRedis: () => ({
    eval: redisEval,
    get: redisGet,
  }),
}));

describe("checkRateLimit", () => {
  beforeEach(() => {
    vi.resetModules();
    redisEval.mockReset();
    redisGet.mockReset();
  });

  it("returns the Redis sliding-window result", async () => {
    redisEval.mockResolvedValue([1, 4, 10_000]);
    const { checkRateLimit } = await import("@/lib/rate-limit");

    await expect(checkRateLimit("user:1", 5, 1_000)).resolves.toEqual({
      allowed: true,
      remaining: 4,
      resetTime: 10_000,
    });
    expect(redisEval).toHaveBeenCalledOnce();
  });

  it("falls back to memory when Redis is unavailable", async () => {
    redisEval.mockRejectedValue(new Error("offline"));
    const { checkRateLimit } = await import("@/lib/rate-limit");

    const first = await checkRateLimit("fallback:1", 1, 60_000);
    const second = await checkRateLimit("fallback:1", 1, 60_000);

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(false);
  });
});
