"use client";

import { AlertTriangle, Minimize2, AlertOctagon } from "lucide-react";
import { cn } from "@/lib/utils";

type ContextBudgetState = {
  status: "warn" | "compress" | "overflow";
  tokens: number;
  ratio: number;
};

type ContextBudgetWarningProps = {
  contextBudget: ContextBudgetState | null;
};

export function ContextBudgetWarning({
  contextBudget,
}: ContextBudgetWarningProps) {
  if (!contextBudget) return null;

  const percent = Math.round(contextBudget.ratio * 100);

  if (contextBudget.status === "overflow") {
    return (
      <div
        className={cn(
          "flex items-center gap-2 px-4 py-2 mx-4 mt-2 rounded-[var(--radius-md)]",
          "bg-[var(--color-error-muted)] text-sm text-[var(--color-error)]"
        )}
      >
        <AlertOctagon size={14} strokeWidth={2} className="shrink-0" />
        <span className="flex-1">
          上下文已超出上限（{percent}% / {contextBudget.tokens.toLocaleString()}{" "}
          tokens）。请新建对话或输入 /compact 压缩历史。
        </span>
      </div>
    );
  }

  if (contextBudget.status === "compress") {
    return (
      <div
        className={cn(
          "flex items-center gap-2 px-4 py-2 mx-4 mt-2 rounded-[var(--radius-md)]",
          "bg-amber-500/10 text-sm text-amber-700 dark:text-amber-400"
        )}
      >
        <Minimize2 size={14} strokeWidth={2} className="shrink-0" />
        <span className="flex-1">
          上下文已自动压缩（已用 {percent}% /{" "}
          {contextBudget.tokens.toLocaleString()} tokens）。
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-4 py-2 mx-4 mt-2 rounded-[var(--radius-md)]",
        "bg-yellow-500/10 text-sm text-yellow-700 dark:text-yellow-400"
      )}
    >
      <AlertTriangle size={14} strokeWidth={2} className="shrink-0" />
      <span className="flex-1">
        上下文接近上限（已用 {percent}% / {contextBudget.tokens.toLocaleString()}{" "}
        tokens）。
      </span>
    </div>
  );
}
