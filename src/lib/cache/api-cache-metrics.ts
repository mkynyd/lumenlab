import { prisma } from "@/lib/db";
import { getRedis } from "@/lib/redis";

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

function providerForModel(model: string): "deepseek" | "minimax" {
  return model.toLowerCase().includes("minimax") ? "minimax" : "deepseek";
}

export function aggregateCacheRows(rows: CacheMetricRow[]) {
  const overall = emptySummary();
  const dailyMap = new Map<string, CacheMetricSummary>();
  const providers = {
    deepseek: emptySummary(),
    minimax: emptySummary(),
  };
  const projects: Record<string, CacheMetricSummary> = {};

  for (const row of rows) {
    addRow(overall, row);
    const date = row.createdAt.toISOString().slice(0, 10);
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
    },
    projects: Object.fromEntries(
      Object.entries(projects).map(([id, summary]) => [id, finalize(summary)])
    ),
  };
}

async function getRows(userId: string, days?: number) {
  const createdAt = days
    ? { gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) }
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

export async function getCacheMetrics(userId: string, days = 7) {
  return aggregateCacheRows(await getRows(userId, days));
}

export async function getCacheMetricsByProvider(userId: string) {
  return (await getCacheMetrics(userId, 30)).providers;
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
