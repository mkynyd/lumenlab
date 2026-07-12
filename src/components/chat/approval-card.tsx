"use client";

import { AlertTriangle, ExternalLink, FileText, RotateCcw } from "lucide-react";
import { useState } from "react";
import type {
  ApprovalScope,
  ToolCallPreview,
} from "@/lib/agent/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ApprovalCardProps {
  preview: ToolCallPreview;
  canApproveSession: boolean;
  onApprove: (scope: ApprovalScope) => Promise<void> | void;
  onDeny: (reason?: string) => Promise<void> | void;
}

export function ApprovalCard({
  preview,
  canApproveSession,
  onApprove,
  onDeny,
}: ApprovalCardProps) {
  const [busy, setBusy] = useState(false);

  async function handle(scope: ApprovalScope) {
    if (busy) return;
    setBusy(true);
    try {
      await onApprove(scope);
    } catch {
      // The parent owns error presentation; keep this approval card pending.
    } finally {
      setBusy(false);
    }
  }

  async function handleDeny() {
    if (busy) return;
    setBusy(true);
    try {
      await onDeny();
    } catch {
      // The parent owns error presentation; keep this approval card pending.
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl bg-[var(--color-project-control)] p-3 text-sm space-y-3">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 inline-flex size-5 items-center justify-center rounded-full bg-[var(--color-accent)]/15 text-[var(--color-accent)]">
          <AlertTriangle size={12} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-[var(--color-text-primary)] leading-tight">
            {preview.summary}
          </p>
          {preview.skillName && (
            <p className="mt-0.5 text-xs text-[var(--color-text-tertiary)] font-mono">
              {preview.skillName}
            </p>
          )}
        </div>
      </div>

      {preview.affectedResources.length > 0 && (
        <ul className="space-y-1">
          {preview.affectedResources.slice(0, 6).map((res) => (
            <li
              key={`${res.type}-${res.identifier}`}
              className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]"
            >
              {res.type === "url" ? (
                <ExternalLink size={11} className="shrink-0 text-[var(--color-text-tertiary)]" />
              ) : (
                <FileText size={11} className="shrink-0 text-[var(--color-text-tertiary)]" />
              )}
              <span className="truncate">{res.displayName}</span>
              <span className="ml-auto text-xs text-[var(--color-text-tertiary)]">
                {res.type}
              </span>
            </li>
          ))}
          {preview.affectedResources.length > 6 && (
            <li className="text-xs text-[var(--color-text-tertiary)]">
              等 {preview.affectedResources.length} 项
            </li>
          )}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {preview.sendsToExternal && (
          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-warning,#b45309)]/12 px-2 py-0.5 text-[var(--color-warning,#b45309)]">
            <ExternalLink size={10} />
            将数据发送到外部
          </span>
        )}
        {!preview.isReversible && (
          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-error)]/12 px-2 py-0.5 text-[var(--color-error)]">
            不可撤销
          </span>
        )}
        {preview.estimatedCost && preview.estimatedCost !== "free" && (
          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-surface)] px-2 py-0.5 text-[var(--color-text-secondary)]">
            {preview.estimatedCost}
          </span>
        )}
        {typeof preview.batchCount === "number" && preview.batchCount > 1 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-surface)] px-2 py-0.5 text-[var(--color-text-secondary)]">
            批量 {preview.batchCount}
          </span>
        )}
      </div>

      {preview.samplePreview && (
        <details className="text-xs">
          <summary className="cursor-pointer text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] inline-flex items-center gap-1">
            <RotateCcw size={10} /> 查看数据样本
          </summary>
          <pre className="mt-1 max-h-32 overflow-auto rounded-md bg-[var(--color-surface)] p-2 whitespace-pre-wrap break-words text-[var(--color-text-secondary)]">
            {preview.samplePreview}
          </pre>
        </details>
      )}

      <div className="flex items-center gap-2 pt-1">
        <Button
          variant="primary"
          size="sm"
          disabled={busy}
          onClick={() => handle("once")}
          className={cn("rounded-lg")}
        >
          仅本次允许
        </Button>
        {canApproveSession && (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => handle("session")}
            className="rounded-lg"
          >
            本会话同类允许
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={handleDeny}
          className="rounded-lg ml-auto text-[var(--color-text-secondary)]"
        >
          拒绝
        </Button>
      </div>
    </div>
  );
}
