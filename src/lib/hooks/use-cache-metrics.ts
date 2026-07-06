"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api/client";
import type {
  CacheMetricSummary,
  DailyCacheMetric,
  TokenUsageSummary,
} from "@/lib/cache/api-cache-metrics";
import { queryKeys } from "@/lib/query-keys";

export interface CacheMetricsResponse {
  days: number;
  cycle?: { start: string; end: string };
  overall: CacheMetricSummary;
  daily: DailyCacheMetric[];
  providers: Record<"deepseek" | "minimax", CacheMetricSummary>;
  tokenUsage: TokenUsageSummary;
  exports: Record<
    "markdown" | "docx" | "pdf",
    { hits: number; misses: number; hitRate: number }
  >;
  rag: Record<
    "search" | "file-select" | "query-embed",
    { hits: number; misses: number; hitRate: number }
  >;
}

function toISODate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function useCacheMetrics(
  range: { start: Date; end: Date } | number | "cycle" = 7
) {
  const queryParams =
    typeof range === "number"
      ? `days=${range}`
      : range === "cycle"
        ? "range=cycle"
      : `start=${toISODate(range.start)}&end=${toISODate(range.end)}`;

  const queryKey =
    typeof range === "number"
      ? queryKeys.cacheMetrics(range)
      : range === "cycle"
        ? queryKeys.cacheMetrics("cycle")
      : queryKeys.cacheMetrics({
          start: toISODate(range.start),
          end: toISODate(range.end),
        });

  return useQuery({
    queryKey,
    queryFn: () =>
      fetchJson<CacheMetricsResponse>(`/api/metrics/cache?${queryParams}`),
  });
}
