"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

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
    modelDistribution: Array<{ model: string; credits: number; tokens: number }>;
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

  return (
    <div className="mx-auto h-full w-full max-w-3xl overflow-y-auto p-6 pb-12">
      <h1 className="mb-6 text-2xl font-semibold text-[var(--color-text-primary)]">
        用量统计
      </h1>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-[var(--radius-lg)] bg-[var(--color-panel)] p-4">
          <div className="text-sm text-[var(--color-text-secondary)]">当前等级</div>
          <div className="mt-1 text-lg font-medium text-[var(--color-text-primary)] uppercase">
            {data.tier}
          </div>
        </div>
        <div className="rounded-[var(--radius-lg)] bg-[var(--color-panel)] p-4">
          <div className="text-sm text-[var(--color-text-secondary)]">周期</div>
          <div className="mt-1 text-sm text-[var(--color-text-primary)]">
            {formatDate(data.cycle.start)} - {formatDate(data.cycle.end)}
          </div>
        </div>
        <div className="rounded-[var(--radius-lg)] bg-[var(--color-panel)] p-4">
          <div className="text-sm text-[var(--color-text-secondary)]">
            {data.quota.enforced ? "剩余额度" : "已用额度（A 测不限额）"}
          </div>
          <div className="mt-1 text-lg font-medium text-[var(--color-text-primary)]">
            {data.quota.enforced
              ? `${(data.quota.remaining ?? 0).toLocaleString()} / ${(data.quota.total ?? 0).toLocaleString()}`
              : data.quota.used.toLocaleString()}
            {" "}Credits
          </div>
        </div>
      </div>

      <div className="mb-6 rounded-[var(--radius-lg)] bg-[var(--color-panel)] p-4">
        <h2 className="mb-4 text-base font-medium text-[var(--color-text-primary)]">
          本期用量
        </h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <div className="text-xs text-[var(--color-text-secondary)]">周期Credits</div>
            <div className="text-lg font-medium text-[var(--color-text-primary)]">
              {data.usage.currentCycleCredits.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-xs text-[var(--color-text-secondary)]">周期 tokens</div>
            <div className="text-lg font-medium text-[var(--color-text-primary)]">
              {data.usage.currentCycleTokens.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-xs text-[var(--color-text-secondary)]">24 小时</div>
            <div className="text-lg font-medium text-[var(--color-text-primary)]">
              {data.usage.last24hCredits.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-xs text-[var(--color-text-secondary)]">7 天</div>
            <div className="text-lg font-medium text-[var(--color-text-primary)]">
              {data.usage.last7dCredits.toLocaleString()}
            </div>
          </div>
        </div>
        <div className="mt-4">
          <div className="text-xs text-[var(--color-text-secondary)]">最近 5 小时</div>
          <div className="text-lg font-medium text-[var(--color-text-primary)]">
            {data.usage.last5hCredits.toLocaleString()} Credits
          </div>
        </div>
      </div>

      {data.usage.modelDistribution.length > 0 && (
        <div className="mb-6 rounded-[var(--radius-lg)] bg-[var(--color-panel)] p-4">
          <h2 className="mb-4 text-base font-medium text-[var(--color-text-primary)]">
            模型分布
          </h2>
          <div className="space-y-2">
            {data.usage.modelDistribution.map((item) => (
              <div
                key={item.model}
                className="flex items-center justify-between rounded-[var(--radius-md)] bg-[var(--color-panel-muted)] px-3 py-2"
              >
                <span className="text-sm text-[var(--color-text-primary)]">
                  {item.model}
                </span>
                <div className="text-right text-sm text-[var(--color-text-secondary)]">
                  <div>{item.credits.toLocaleString()} Credits</div>
                  <div>{item.tokens.toLocaleString()} tokens</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.usage.recentRecords.length > 0 && (
        <div className="rounded-[var(--radius-lg)] bg-[var(--color-panel)] p-4">
          <h2 className="mb-4 text-base font-medium text-[var(--color-text-primary)]">
            最近请求
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-[var(--color-text-secondary)]">
                <tr>
                  <th className="pb-2 font-medium">时间</th>
                  <th className="pb-2 font-medium">模型</th>
                  <th className="pb-2 font-medium">tokens</th>
                  <th className="pb-2 font-medium">Credits</th>
                </tr>
              </thead>
              <tbody className="text-[var(--color-text-primary)]">
                {data.usage.recentRecords.map((record) => (
                  <tr
                    key={record.id}
                    className="border-t border-[var(--color-border-light)]"
                  >
                    <td className="py-2">
                      {new Date(record.createdAt).toLocaleString("zh-CN")}
                    </td>
                    <td className="py-2">{record.model}</td>
                    <td className="py-2">{record.totalTokens.toLocaleString()}</td>
                    <td className="py-2">{record.creditsConsumed.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
