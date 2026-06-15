import { describe, expect, it } from "vitest";
import { aggregateCacheRows } from "@/lib/cache/api-cache-metrics";

describe("aggregateCacheRows", () => {
  it("aggregates token hit rates by day and provider", () => {
    const result = aggregateCacheRows([
      {
        createdAt: new Date("2026-06-14T10:00:00Z"),
        cacheHitTokens: 80,
        cacheMissTokens: 20,
        model: "deepseek-v4-pro",
        projectId: "project-1",
      },
      {
        createdAt: new Date("2026-06-14T12:00:00Z"),
        cacheHitTokens: 0,
        cacheMissTokens: 50,
        model: "minimax-m2",
        projectId: null,
      },
    ]);

    expect(result.daily[0]).toMatchObject({
      date: "2026-06-14",
      totalHitTokens: 80,
      totalMissTokens: 70,
      requestCount: 2,
    });
    expect(result.providers.deepseek.hitRate).toBe(0.8);
    expect(result.providers.minimax.hitRate).toBe(0);
    expect(result.overall.hitRate).toBeCloseTo(80 / 150);
  });

  it("returns a zero hit rate when there are no cache tokens", () => {
    const result = aggregateCacheRows([]);
    expect(result.overall.hitRate).toBe(0);
    expect(result.overall.requestCount).toBe(0);
  });
});
