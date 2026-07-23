"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Progress } from "@/components/ui/progress";

type UsageResponse = {
  tier: string;
  cycle: { start: string; end: string };
  quota: {
    total: number | null;
    used: number;
    remaining: number | null;
    enforced: boolean;
  };
  usage: {
    currentCycleCredits: number;
    currentCycleTokens: number;
    last24hCredits: number;
    last7dCredits: number;
    last5hCredits: number;
    modelDistribution: Array<{
      model: string;
      credits: number;
      tokens: number;
    }>;
    recentRecords: Array<{
      id: string;
      model: string;
      provider: string;
      totalTokens: number;
      creditsConsumed: number;
      createdAt: string;
    }>;
  };
};

export default function UsagePage() {
  const router = useRouter();
  const [data, setData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/me/usage")
      .then(async (res) => {
        if (res.status === 401) {
          router.push("/login");
          return null;
        }
        if (!res.ok) throw new Error(await res.text());
        return res.json() as Promise<UsageResponse>;
      })
      .then((json) => {
        if (json) setData(json);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "加载失败");
      })
      .finally(() => setLoading(false));
  }, [router]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--color-text-secondary)]">
        加载用量数据中…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--color-error)]">
        {error || "无法加载用量数据"}
      </div>
    );
  }

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  const tierLabel = data.tier === "premium" ? "A 测用户" : data.tier;
  const modelLabel = (model: string) => {
    if (model === "deepseek-v4-flash") return "DeepSeek · 快速";
    if (model === "deepseek-v4-pro") return "DeepSeek · 深度";
    if (model === "minimax-m3") return "MiniMax";
    return model;
  };
  const totalModelCredits = Math.max(
    data.usage.modelDistribution.reduce(
      (sum, item) => sum + item.credits,
      0,
    ),
    1,
  );
  const quotaUsage =
    data.quota.enforced && data.quota.total
      ? Math.min(100, (data.quota.used / data.quota.total) * 100)
      : null;

  return (
    <div className="h-full overflow-y-auto">
      <main className="mx-auto w-full max-w-4xl px-4 py-7 pb-14 sm:px-8 sm:py-10">
        <header>
          <p className="text-xs font-medium text-[var(--color-text-tertiary)]">
            账户
          </p>
          <h1 className="mt-1.5 text-xl font-semibold tracking-tight text-[var(--color-text-primary)]">
            用量统计
          </h1>
          <p className="mt-1.5 text-sm text-[var(--color-text-secondary)]">
            查看本计费周期的额度、模型分布与最近请求。
          </p>
        </header>

        <section
          aria-label="账户用量概览"
          className="mt-7 grid border-y border-[var(--color-border-light)] sm:grid-cols-3 sm:divide-x sm:divide-[var(--color-border-light)]"
        >
          <div className="border-b border-[var(--color-border-light)] py-3.5 sm:border-b-0 sm:px-4 sm:first:pl-0">
            <p className="text-xs text-[var(--color-text-tertiary)]">
              当前等级
            </p>
            <p className="mt-1 text-base font-medium text-[var(--color-text-primary)]">
              {tierLabel}
            </p>
          </div>
          <div className="border-b border-[var(--color-border-light)] py-3.5 sm:border-b-0 sm:px-4">
            <p className="text-xs text-[var(--color-text-tertiary)]">
              统计周期
            </p>
            <p className="mt-1 text-sm font-medium tabular-nums text-[var(--color-text-primary)]">
              {formatDate(data.cycle.start)} – {formatDate(data.cycle.end)}
            </p>
          </div>
          <div className="py-3.5 sm:px-4 sm:last:pr-0">
            <p className="text-xs text-[var(--color-text-tertiary)]">
              {data.quota.enforced ? "剩余额度" : "已用额度 · A 测不限额"}
            </p>
            <p className="mt-1 text-base font-medium tabular-nums text-[var(--color-text-primary)]">
              {data.quota.enforced
                ? `${(data.quota.remaining ?? 0).toLocaleString()} / ${(data.quota.total ?? 0).toLocaleString()}`
                : data.quota.used.toLocaleString()}{" "}
              <span className="text-xs font-normal text-[var(--color-text-tertiary)]">
                Credits
              </span>
            </p>
            {quotaUsage !== null && (
              <Progress
                value={quotaUsage}
                size="sm"
                color="accent"
                label={`已使用 ${Math.round(quotaUsage)}% 额度`}
                className="mt-2.5"
              />
            )}
          </div>
        </section>

        <section aria-labelledby="cycle-usage-heading" className="mt-8">
          <h2
            id="cycle-usage-heading"
            className="text-sm font-semibold text-[var(--color-text-primary)]"
          >
            本期用量
          </h2>
          <dl className="mt-2 grid grid-cols-2 gap-x-6 sm:grid-cols-5">
            {[
              ["周期 Credits", data.usage.currentCycleCredits],
              ["周期 tokens", data.usage.currentCycleTokens],
              ["最近 24 小时", data.usage.last24hCredits],
              ["最近 7 天", data.usage.last7dCredits],
              ["最近 5 小时", data.usage.last5hCredits],
            ].map(([label, value]) => (
              <div
                key={String(label)}
                className="border-b border-[var(--color-border-light)] py-3"
              >
                <dt className="text-xs text-[var(--color-text-tertiary)]">
                  {label}
                </dt>
                <dd className="mt-1 text-base font-medium tabular-nums text-[var(--color-text-primary)]">
                  {Number(value).toLocaleString()}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {data.usage.modelDistribution.length > 0 && (
          <section
            aria-labelledby="model-distribution-heading"
            className="mt-8"
          >
            <h2
              id="model-distribution-heading"
              className="text-sm font-semibold text-[var(--color-text-primary)]"
            >
              模型分布
            </h2>
            <div className="mt-2 divide-y divide-[var(--color-border-light)] border-y border-[var(--color-border-light)]">
              {data.usage.modelDistribution.map((item) => (
                <div
                  key={item.model}
                  className="grid gap-2 py-3 sm:grid-cols-[minmax(9rem,0.8fr)_minmax(12rem,1fr)_auto] sm:items-center sm:gap-5"
                >
                  <span className="text-sm font-medium text-[var(--color-text-primary)]">
                    {modelLabel(item.model)}
                  </span>
                  <Progress
                    value={(item.credits / totalModelCredits) * 100}
                    size="sm"
                    color="accent"
                    label={`${modelLabel(item.model)} 占模型用量 ${Math.round(
                      (item.credits / totalModelCredits) * 100,
                    )}%`}
                  />
                  <div className="flex gap-3 text-xs tabular-nums text-[var(--color-text-secondary)] sm:block sm:min-w-28 sm:text-right">
                    <span>{item.credits.toLocaleString()} Credits</span>
                    <span className="text-[var(--color-text-tertiary)] sm:block">
                      {item.tokens.toLocaleString()} tokens
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {data.usage.recentRecords.length > 0 && (
          <section aria-labelledby="recent-requests-heading" className="mt-8">
            <h2
              id="recent-requests-heading"
              className="text-sm font-semibold text-[var(--color-text-primary)]"
            >
              最近请求
            </h2>
            <div className="mt-2 overflow-x-auto border-y border-[var(--color-border-light)]">
              <table className="w-full min-w-[36rem] text-left text-sm">
                <thead className="text-xs text-[var(--color-text-tertiary)]">
                  <tr>
                    <th className="py-2.5 font-medium">时间</th>
                    <th className="py-2.5 font-medium">模型</th>
                    <th className="py-2.5 text-right font-medium">tokens</th>
                    <th className="py-2.5 text-right font-medium">Credits</th>
                  </tr>
                </thead>
                <tbody className="text-[var(--color-text-primary)]">
                  {data.usage.recentRecords.map((record) => (
                    <tr
                      key={record.id}
                      className="border-t border-[var(--color-border-light)]"
                    >
                      <td className="py-2.5 pr-4 tabular-nums text-[var(--color-text-secondary)]">
                        {new Date(record.createdAt).toLocaleString("zh-CN")}
                      </td>
                      <td className="py-2.5 pr-4">
                        {modelLabel(record.model)}
                      </td>
                      <td className="py-2.5 text-right tabular-nums">
                        {record.totalTokens.toLocaleString()}
                      </td>
                      <td className="py-2.5 text-right tabular-nums">
                        {record.creditsConsumed.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
