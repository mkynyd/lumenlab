"use client";

import { ChevronDown, ChevronRight, Loader2, Check, X, AlertTriangle } from "lucide-react";
import { useState } from "react";
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

export function ToolCallCard({
  preview,
  status,
  progress,
  message,
  resultSummary,
  error,
}: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);
  const showResult = status === "completed" || status === "failed";
  const expandable = showResult && (resultSummary || error);

  return (
    <div
      className={cn(
        "rounded-xl px-3 py-2 text-xs",
        "bg-[var(--color-project-control)]",
        status === "failed" && "text-[var(--color-error)]",
        status === "completed" && "text-[var(--color-success)]"
      )}
    >
      <div className="flex items-center gap-2">
        {status === "executing" ? (
          <Loader2 size={12} className="animate-spin shrink-0" />
        ) : status === "completed" ? (
          <Check size={12} className="shrink-0" />
        ) : status === "failed" ? (
          <X size={12} className="shrink-0" />
        ) : (
          <span className="size-2 rounded-full bg-[var(--color-text-tertiary)] shrink-0" />
        )}
        <span className="text-[var(--color-text-primary)] font-medium truncate flex-1">
          {preview.summary}
        </span>
        {preview.skillName && (
          <span className="text-[var(--color-text-tertiary)] font-mono text-[10px]">
            {preview.skillName}
          </span>
        )}
        {expandable && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="ml-1 inline-flex items-center justify-center size-5 rounded-md hover:bg-[var(--color-interaction-hover)] text-[var(--color-text-tertiary)]"
            aria-label={expanded ? "折叠结果" : "展开结果"}
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        )}
      </div>
      {status === "executing" && typeof progress === "number" && (
        <div className="mt-2 h-1 w-full rounded-full bg-[var(--color-border-light)] overflow-hidden">
          <div
            className="h-full bg-[var(--color-accent)] transition-[width]"
            style={{ width: `${Math.max(0, Math.min(100, progress * 100))}%` }}
          />
        </div>
      )}
      {message && (
        <div className="mt-1 text-[var(--color-text-tertiary)] truncate">{message}</div>
      )}
      {expandable && expanded && (
        <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-[var(--color-surface)] p-2 text-[11px] whitespace-pre-wrap break-words text-[var(--color-text-secondary)]">
          {error ?? JSON.stringify(resultSummary, null, 2)}
        </pre>
      )}
      {preview.sendsToExternal && (
        <div className="mt-1 flex items-center gap-1 text-[var(--color-warning,#b45309)]">
          <AlertTriangle size={11} />
          <span>会将数据发送到外部</span>
        </div>
      )}
    </div>
  );
}