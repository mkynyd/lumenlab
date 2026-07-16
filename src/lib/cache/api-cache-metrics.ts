import { prisma } from "@/lib/db";
import { getRedis } from "@/lib/redis";
import { getCreditWeightsForUsage } from "@/lib/tokens/credits";
import { getDisplayTotalTokens } from "@/lib/token-usage-display";

export interface CacheMetricRow {
  createdAt: Date;
  cacheHitTokens: number | null;
  cacheMissTokens: number | null;
  model: string;
  projectId: string | null;
}

export interface CacheMetricSummary {
  totalHitTokens: number;
  totalMissTokens: number;
  hitRate: number;
  requestCount: number;
}

export interface DailyCacheMetric extends CacheMetricSummary {
  date: string;
}

export interface TokenUsageRow {
  createdAt: Date;
  tokenCount: number | null;
  provider: string | null;
  model?: string | null;
  inputCacheHitTokens?: number | null;
  inputCacheMissTokens?: number | null;
  outputTokens?: number | null;
}

export interface TokenUsageSummary {
  totalTokens: number;
  todayTokens: number;
  requestCount: number;
  unattributedTokens: number;
  estimatedCostCny: number;
  inputTokens: number;
  outputTokens: number;
  inputCacheHitTokens: number;
  inputCacheMissTokens: number;
  daily: Array<{
    date: string;
    totalTokens: number;
    inputCacheHitTokens: number;
    inputCacheMissTokens: number;
    outputTokens: number;
  }>;
  providers: Record<
    "deepseek" | "minimax" | "bailian",
    { totalTokens: number; requestCount: number; estimatedCostCny: number }
  >;
}

function emptySummary(): CacheMetricSummary {
  return {
    totalHitTokens: 0,
    totalMissTokens: 0,
    hitRate: 0,
    requestCount: 0,
  };
}

function addRow(summary: CacheMetricSummary, row: CacheMetricRow): void {
  summary.totalHitTokens += row.cacheHitTokens || 0;
  summary.totalMissTokens += row.cacheMissTokens || 0;
  summary.requestCount += 1;
}

function finalize(summary: CacheMetricSummary): CacheMetricSummary {
  const total = summary.totalHitTokens + summary.totalMissTokens;
  return { ...summary, hitRate: total > 0 ? summary.totalHitTokens / total : 0 };
}

function providerForModel(model: string): "deepseek" | "minimax" | "bailian" {
  if (model.toLowerCase().startsWith("qwen")) return "bailian";
  return model.toLowerCase().includes("minimax") ? "minimax" : "deepseek";
}

const PRODUCT_TIME_ZONE = process.env.LUMENLAB_TIME_ZONE || "Asia/Shanghai";

export function productDateKey(date: Date, timeZone = PRODUCT_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function aggregateCacheRows(rows: CacheMetricRow[]) {
  const overall = emptySummary();
  const dailyMap = new Map<string, CacheMetricSummary>();
  const providers = {
    deepseek: emptySummary(),
    minimax: emptySummary(),
    bailian: emptySummary(),
  };
  const projects: Record<string, CacheMetricSummary> = {};

  for (const row of rows) {
    addRow(overall, row);
    const date = productDateKey(row.createdAt);
    const daily = dailyMap.get(date) || emptySummary();
    addRow(daily, row);
    dailyMap.set(date, daily);
    addRow(providers[providerForModel(row.model)], row);
    if (row.projectId) {
      projects[row.projectId] ||= emptySummary();
      addRow(projects[row.projectId], row);
    }
  }

  return {
    overall: finalize(overall),
    daily: [...dailyMap.entries()]
      .map(([date, summary]) => ({ date, ...finalize(summary) }))
      .sort((left, right) => left.date.localeCompare(right.date)),
    providers: {
      deepseek: finalize(providers.deepseek),
      minimax: finalize(providers.minimax),
      bailian: finalize(providers.bailian),
    },
    projects: Object.fromEntries(
      Object.entries(projects).map(([id, summary]) => [id, finalize(summary)])
    ),
  };
}

export function aggregateTokenUsageRows(
  rows: TokenUsageRow[],
  todayDate = productDateKey(new Date())
): TokenUsageSummary {
  const summary: TokenUsageSummary = {
    totalTokens: 0,
    todayTokens: 0,
    requestCount: 0,
    unattributedTokens: 0,
    estimatedCostCny: 0,
    inputTokens: 0,
    outputTokens: 0,
    inputCacheHitTokens: 0,
    inputCacheMissTokens: 0,
    daily: [],
    providers: {
      deepseek: { totalTokens: 0, requestCount: 0, estimatedCostCny: 0 },
      minimax: { totalTokens: 0, requestCount: 0, estimatedCostCny: 0 },
      bailian: { totalTokens: 0, requestCount: 0, estimatedCostCny: 0 },
    },
  };

  const dailyMap = new Map<
    string,
    {
      totalTokens: number;
      inputCacheHitTokens: number;
      inputCacheMissTokens: number;
      outputTokens: number;
    }
  >();

  for (const row of rows) {
    if (row.tokenCount === null) continue;
    const inputCacheHitTokens = row.inputCacheHitTokens || 0;
    const outputTokens = row.outputTokens || 0;
    const recordedMissTokens = row.inputCacheMissTokens || 0;
    const measuredInputTokens = Math.max(
      row.tokenCount - outputTokens,
      inputCacheHitTokens + recordedMissTokens,
      0
    );
    const inputCacheMissTokens =
      recordedMissTokens +
      Math.max(measuredInputTokens - inputCacheHitTokens - recordedMissTokens, 0);
    const inputTokens = inputCacheHitTokens + inputCacheMissTokens;
    const totalTokens = getDisplayTotalTokens({
      tokenCount: row.tokenCount,
      inputCacheHitTokens,
      inputCacheMissTokens,
      outputTokens,
    });
    const weights = row.model
      ? getCreditWeightsForUsage(row.model, inputCacheHitTokens + inputCacheMissTokens)
      : undefined;
    const estimatedCostCny = weights
      ? (inputCacheHitTokens * weights.hit +
          inputCacheMissTokens * weights.miss +
          outputTokens * weights.out) /
        1_000_000
      : 0;

    summary.totalTokens += totalTokens;
    summary.inputTokens += inputTokens;
    summary.outputTokens += outputTokens;
    summary.inputCacheHitTokens += inputCacheHitTokens;
    summary.inputCacheMissTokens += inputCacheMissTokens;
    summary.estimatedCostCny += estimatedCostCny;
    summary.requestCount += 1;

    const date = productDateKey(row.createdAt);
    if (date === todayDate) {
      summary.todayTokens += totalTokens;
    }

    const daily = dailyMap.get(date) || {
      totalTokens: 0,
      inputCacheHitTokens: 0,
      inputCacheMissTokens: 0,
      outputTokens: 0,
    };
    daily.totalTokens += totalTokens;
    daily.inputCacheHitTokens += inputCacheHitTokens;
    daily.inputCacheMissTokens += inputCacheMissTokens;
    daily.outputTokens += outputTokens;
    dailyMap.set(date, daily);

    if (
      row.provider === "deepseek" ||
      row.provider === "minimax" ||
      row.provider === "bailian"
    ) {
      summary.providers[row.provider].totalTokens += totalTokens;
      summary.providers[row.provider].requestCount += 1;
      summary.providers[row.provider].estimatedCostCny += estimatedCostCny;
    } else {
      summary.unattributedTokens += totalTokens;
    }
  }

  summary.daily = [...dailyMap.entries()]
    .map(([date, values]) => ({ date, ...values }))
    .sort((left, right) => left.date.localeCompare(right.date));

  return summary;
}

function endOfDay(date: Date) {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
}

async function getRows(
  userId: string,
  daysOrRange?: number | { start: Date; end: Date }
) {
  const createdAt =
    typeof daysOrRange === "number"
      ? { gte: new Date(Date.now() - daysOrRange * 24 * 60 * 60 * 1000) }
      : daysOrRange
        ? { gte: daysOrRange.start, lte: endOfDay(daysOrRange.end) }
        : undefined;
  const messages = await prisma.message.findMany({
    where: {
      conversation: { userId },
      ...(createdAt ? { createdAt } : {}),
      OR: [
        { cacheHitTokens: { not: null } },
        { cacheMissTokens: { not: null } },
      ],
    },
    select: {
      createdAt: true,
      cacheHitTokens: true,
      cacheMissTokens: true,
      conversation: {
        select: { model: true, projectId: true },
      },
    },
  });
  return messages.map((message) => ({
    createdAt: message.createdAt,
    cacheHitTokens: message.cacheHitTokens,
    cacheMissTokens: message.cacheMissTokens,
    model: message.conversation.model,
    projectId: message.conversation.projectId,
  }));
}

export async function getCacheMetrics(
  userId: string,
  daysOrRange: number | { start: Date; end: Date } = 7
) {
  return aggregateCacheRows(await getRows(userId, daysOrRange));
}

export async function getTokenUsageMetrics(
  userId: string,
  daysOrRange: number | { start: Date; end: Date } = 7
) {
  const createdAt =
    typeof daysOrRange === "number"
      ? { gte: new Date(Date.now() - daysOrRange * 24 * 60 * 60 * 1000) }
      : { gte: daysOrRange.start, lte: endOfDay(daysOrRange.end) };
  const rows = await prisma.tokenUsage.findMany({
    where: {
      userId,
      createdAt,
    },
    select: {
      createdAt: true,
      totalTokens: true,
      provider: true,
      model: true,
      inputCacheHitTokens: true,
      inputCacheMissTokens: true,
      outputTokens: true,
    },
  });
  return aggregateTokenUsageRows(
    rows.map((row) => ({
      createdAt: row.createdAt,
      tokenCount: row.totalTokens,
      provider: row.provider,
      model: row.model,
      inputCacheHitTokens: row.inputCacheHitTokens,
      inputCacheMissTokens: row.inputCacheMissTokens,
      outputTokens: row.outputTokens,
    }))
  );
}

export async function getCacheMetricsByProvider(userId: string) {
  const end = new Date();
  const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  return (await getCacheMetrics(userId, { start, end })).providers;
}

export async function getCacheMetricsByProject(
  userId: string,
  projectId: string
) {
  const rows = (await getRows(userId)).filter(
    (row) => row.projectId === projectId
  );
  return aggregateCacheRows(rows).overall;
}

export type RagCacheKind = "search" | "file-select" | "query-embed";

export async function recordRagCacheResult(
  kind: RagCacheKind,
  result: "hit" | "miss"
): Promise<void> {
  try {
    await getRedis().incr(`rag:${kind}:${result}`);
  } catch {
    // Metrics must never break retrieval.
  }
}

export async function getRagCacheMetrics() {
  const kinds: RagCacheKind[] = ["search", "file-select", "query-embed"];
  try {
    const keys = kinds.flatMap((kind) => [
      `rag:${kind}:hit`,
      `rag:${kind}:miss`,
    ]);
    const values = await getRedis().mget(...keys);
    return Object.fromEntries(
      kinds.map((kind, index) => {
        const hits = Number(values[index * 2] || 0);
        const misses = Number(values[index * 2 + 1] || 0);
        return [
          kind,
          {
            hits,
            misses,
            hitRate: hits + misses > 0 ? hits / (hits + misses) : 0,
          },
        ];
      })
    );
  } catch {
    return Object.fromEntries(
      kinds.map((kind) => [
        kind,
        { hits: 0, misses: 0, hitRate: 0 },
      ])
    );
  }
}

export async function getExportCacheMetrics() {
  const formats = ["markdown", "docx", "pdf"] as const;
  try {
    const keys = formats.flatMap((format) => [
      `export:${format}:hit`,
      `export:${format}:miss`,
    ]);
    const values = await getRedis().mget(...keys);
    return Object.fromEntries(
      formats.map((format, index) => {
        const hits = Number(values[index * 2] || 0);
        const misses = Number(values[index * 2 + 1] || 0);
        return [
          format,
          {
            hits,
            misses,
            hitRate: hits + misses > 0 ? hits / (hits + misses) : 0,
          },
        ];
      })
    );
  } catch {
    return Object.fromEntries(
      formats.map((format) => [
        format,
        { hits: 0, misses: 0, hitRate: 0 },
      ])
    );
  }
}
