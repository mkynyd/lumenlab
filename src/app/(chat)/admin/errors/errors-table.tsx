"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface ErrorRow {
  id: string;
  source: string;
  message: string;
  stack: string | null;
  route: string | null;
  userId: string | null;
  count: number;
  status: string;
  lastSeenAt: string;
}

export function ErrorsTable({ rows }: { rows: ErrorRow[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState(false);

  const setStatus = async (id: string, status: string) => {
    setPendingId(id);
    setError(false);
    try {
      const response = await fetch(`/api/admin/errors/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error(String(response.status));
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setPendingId(null);
    }
  };

  if (rows.length === 0) {
    return <p className="text-sm text-[var(--color-text-secondary)]">暂无错误事件。</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p className="text-sm text-[var(--color-error)]" role="alert">
          操作失败，请重试。
        </p>
      )}
      {rows.map((row) => (
        <details key={row.id} className="rounded-[var(--radius-lg)] bg-[var(--color-panel-muted)] p-4">
          <summary className="flex cursor-pointer flex-wrap items-center gap-3 text-sm">
            <time className="text-[var(--color-text-secondary)]">
              {new Date(row.lastSeenAt).toLocaleString("zh-CN")}
            </time>
            <span className="rounded-full bg-[var(--color-interaction-active)] px-2 py-0.5 text-xs">
              {row.source === "client" ? "前端" : "服务端"}
            </span>
            <span className="max-w-96 truncate font-mono text-xs">{row.message}</span>
            <span className="text-xs text-[var(--color-text-secondary)]">
              {row.route ?? "-"} · {row.count} 次
            </span>
            <span className="ml-auto text-xs text-[var(--color-text-secondary)]">{row.status}</span>
          </summary>
          <div className="mt-3 flex flex-col gap-2 text-sm">
            <p className="text-xs text-[var(--color-text-secondary)]">
              用户：{row.userId ?? "匿名"}
            </p>
            {row.stack && (
              <pre className="max-h-64 overflow-auto rounded-[var(--radius-md)] bg-[var(--color-interaction-hover)] p-3 text-xs">
                {row.stack}
              </pre>
            )}
            <div className="flex gap-2">
              {row.status === "open" && (
                <button
                  type="button"
                  disabled={pendingId === row.id}
                  onClick={() => setStatus(row.id, "resolved")}
                  className="rounded-[var(--radius-md)] bg-[var(--color-interaction-hover)] px-3 py-1 text-sm hover:bg-[var(--color-interaction-active)] disabled:opacity-50"
                >
                  标记已解决
                </button>
              )}
              {row.status !== "ignored" && (
                <button
                  type="button"
                  disabled={pendingId === row.id}
                  onClick={() => setStatus(row.id, "ignored")}
                  className="rounded-[var(--radius-md)] bg-[var(--color-interaction-hover)] px-3 py-1 text-sm hover:bg-[var(--color-interaction-active)] disabled:opacity-50"
                >
                  忽略
                </button>
              )}
            </div>
          </div>
        </details>
      ))}
    </div>
  );
}
