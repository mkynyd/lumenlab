import { Loader2, Check, X, AlertTriangle } from "lucide-react";
import type { ToolCallPreview } from "@/lib/agent/types";
import { cn } from "@/lib/utils";

interface ToolCallCardProps {
  preview: ToolCallPreview;
  status: "proposed" | "executing" | "completed" | "failed";
  progress?: number;
  message?: string;
  resultSummary?: Record<string, unknown>;
  error?: string;
}

const SENSITIVE_RESULT_KEYS = /(?:^|_)(?:query|prompt|system|system_?prompt|hidden_?prompt|context|instruction|instructions|api_?key|authorization|token|headers|cookie)(?:$|_)/i;

export function sanitizeToolResult(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeToolResult);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !SENSITIVE_RESULT_KEYS.test(key.replace(/([a-z])([A-Z])/g, "$1_$2")))
      .map(([key, entry]) => [key, sanitizeToolResult(entry)])
  );
}

/**
 * 单行工具调用记录：状态图标 + 灰色小字，不使用卡片气泡，不提供结果展开。
 */
export function ToolCallCard({
  preview,
  status,
  message,
  error,
}: ToolCallCardProps) {
  return (
    <div className="flex items-center gap-1.5 px-1 py-0.5 text-xs text-[var(--color-text-tertiary)]">
      {status === "executing" ? (
        <Loader2 size={12} className="shrink-0 animate-spin" />
      ) : status === "completed" ? (
        <Check size={12} className="shrink-0" />
      ) : status === "failed" ? (
        <X size={12} className="shrink-0 text-[var(--color-error)]" />
      ) : (
        <span className="size-1.5 shrink-0 rounded-full bg-[var(--color-text-tertiary)]" />
      )}
      <span
        className={cn(
          "min-w-0 truncate",
          status === "failed" && "text-[var(--color-error)]"
        )}
      >
        {preview.summary}
      </span>
      {preview.skillName && (
        <span className="shrink-0 font-mono">{preview.skillName}</span>
      )}
      {status === "executing" && message && (
        <span className="min-w-0 truncate">{message}</span>
      )}
      {status === "failed" && error && (
        <span className="min-w-0 truncate text-[var(--color-error)]">{error}</span>
      )}
      {preview.sendsToExternal && (
        <span className="inline-flex shrink-0 items-center gap-1 text-[var(--color-warning,#b45309)]">
          <AlertTriangle size={11} />
          <span>发送至外部</span>
        </span>
      )}
    </div>
  );
}
