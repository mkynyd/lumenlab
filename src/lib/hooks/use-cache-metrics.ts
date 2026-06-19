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
  overall: CacheMetricSummary;
  daily: DailyCacheMetric[];
  providers: Record<"deepseek" | "minimax", CacheMetricSummary>;
  tokenUsage: TokenUsageSummary;
  exports: Record<
    "markdown" | "docx" | "pdf",
    { hits: number; misses: number; hitRate: number }
  >;
}

export function useCacheMetrics(days = 7) {
  return useQuery({
    queryKey: queryKeys.cacheMetrics(days),
    queryFn: () =>
      fetchJson<CacheMetricsResponse>(`/api/metrics/cache?days=${days}`),
  });
}
