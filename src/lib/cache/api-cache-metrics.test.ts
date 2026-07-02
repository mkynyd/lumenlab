import { describe, expect, it } from "vitest";
import {
  aggregateCacheRows,
  aggregateTokenUsageRows,
} from "@/lib/cache/api-cache-metrics";

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

describe("aggregateTokenUsageRows", () => {
  it("aggregates measured tokens by UTC day and actual provider", () => {
    const result = aggregateTokenUsageRows(
      [
        {
          createdAt: new Date("2026-06-20T01:00:00Z"),
          tokenCount: 200,
          provider: "deepseek",
          model: "deepseek-v4-pro",
          inputCacheHitTokens: 0,
          inputCacheMissTokens: 100,
          outputTokens: 100,
        },
        {
          createdAt: new Date("2026-06-20T02:00:00Z"),
          tokenCount: 100,
          provider: "minimax",
        },
        {
          createdAt: new Date("2026-06-19T23:00:00Z"),
          tokenCount: 120,
          provider: null,
        },
      ],
      "2026-06-20"
    );

    expect(result).toEqual({
      totalTokens: 420,
      todayTokens: 300,
      requestCount: 3,
      unattributedTokens: 120,
      estimatedCostCny: 0.0009,
      inputTokens: 100,
      outputTokens: 100,
      inputCacheHitTokens: 0,
      inputCacheMissTokens: 100,
      daily: [
        {
          date: "2026-06-19",
          totalTokens: 120,
          inputCacheHitTokens: 0,
          inputCacheMissTokens: 0,
          outputTokens: 0,
        },
        {
          date: "2026-06-20",
          totalTokens: 300,
          inputCacheHitTokens: 0,
          inputCacheMissTokens: 100,
          outputTokens: 100,
        },
      ],
      providers: {
        deepseek: {
          totalTokens: 200,
          requestCount: 1,
          estimatedCostCny: 0.0009,
        },
        minimax: { totalTokens: 100, requestCount: 1, estimatedCostCny: 0 },
      },
    });
  });

  it("excludes messages without measured token usage", () => {
    const result = aggregateTokenUsageRows(
      [
        {
          createdAt: new Date("2026-06-20T01:00:00Z"),
          tokenCount: null,
          provider: "deepseek",
        },
      ],
      "2026-06-20"
    );

    expect(result.totalTokens).toBe(0);
    expect(result.todayTokens).toBe(0);
    expect(result.requestCount).toBe(0);
    expect(result.providers.deepseek.requestCount).toBe(0);
  });
});
