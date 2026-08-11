"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface FeedbackRow {
  id: string;
  email: string;
  category: string;
  content: string;
  contact: string | null;
  pagePath: string;
  status: string;
  createdAt: string;
}

const CATEGORY_LABEL: Record<string, string> = {
  bug: "Bug",
  suggestion: "功能建议",
  other: "其他",
};

export function FeedbackTable({ rows }: { rows: FeedbackRow[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState(false);

  const setStatus = async (id: string, status: string) => {
    setPendingId(id);
    setError(false);
    try {
      const response = await fetch(`/api/admin/feedback/${id}`, {
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
    return <p className="text-sm text-[var(--color-text-secondary)]">暂无反馈。</p>;
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
              {new Date(row.createdAt).toLocaleString("zh-CN")}
            </time>
            <span>{row.email}</span>
            <span className="rounded-full bg-[var(--color-interaction-active)] px-2 py-0.5 text-xs">
              {CATEGORY_LABEL[row.category] ?? row.category}
            </span>
            <span className="max-w-96 truncate">{row.content}</span>
            <span className="ml-auto text-xs text-[var(--color-text-secondary)]">{row.status}</span>
          </summary>
          <div className="mt-3 flex flex-col gap-2 text-sm">
            <p className="whitespace-pre-wrap">{row.content}</p>
            <p className="text-[var(--color-text-secondary)]">
              页面：{row.pagePath}
              {row.contact ? ` · 联系方式：${row.contact}` : ""}
            </p>
            <div className="flex gap-2">
              {row.status === "open" && (
                <button
                  type="button"
                  disabled={pendingId === row.id}
                  onClick={() => setStatus(row.id, "resolved")}
                  className="rounded-[var(--radius-md)] bg-[var(--color-interaction-hover)] px-3 py-1 text-sm hover:bg-[var(--color-interaction-active)] disabled:opacity-50"
                >
                  标记已处理
                </button>
              )}
              {row.status !== "closed" && (
                <button
                  type="button"
                  disabled={pendingId === row.id}
                  onClick={() => setStatus(row.id, "closed")}
                  className="rounded-[var(--radius-md)] bg-[var(--color-interaction-hover)] px-3 py-1 text-sm hover:bg-[var(--color-interaction-active)] disabled:opacity-50"
                >
                  关闭
                </button>
              )}
            </div>
          </div>
        </details>
      ))}
    </div>
  );
}
