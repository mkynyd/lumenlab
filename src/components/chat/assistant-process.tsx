"use client";

import { useMemo, useState, type CSSProperties } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  ExternalLink,
  Globe2,
  Loader2,
  X,
} from "lucide-react";
import type { ApprovalScope } from "@/lib/agent/types";
import type {
  AssistantProcessTool,
  AssistantProcessTrace,
} from "@/lib/agent/assistant-process";
import { LoadingIndicator } from "@/components/workbench/loading-indicator";
import { ApprovalCard } from "./approval-card";
import { cn } from "@/lib/utils";

interface AssistantProcessProps {
  trace?: AssistantProcessTrace;
  reasoningContent?: string | null;
  isStreaming: boolean;
  hasResponse: boolean;
  onApprove?: (
    executionId: string,
    token: string,
    scope: ApprovalScope
  ) => Promise<void> | void;
  onDeny?: (executionId: string) => Promise<void> | void;
}

function hostOf(url?: string) {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function elapsedLabel(trace?: AssistantProcessTrace) {
  if (!trace?.startedAt) return null;
  const end = trace.completedAt ?? Date.now();
  const seconds = Math.max(1, Math.round((end - trace.startedAt) / 1_000));
  return `${seconds} 秒`;
}

function ToolIcon({ tool }: { tool: AssistantProcessTool }) {
  if (tool.status === "executing") {
    return <Loader2 size={14} className="animate-spin" aria-hidden />;
  }
  if (tool.status === "completed") return <Check size={14} aria-hidden />;
  if (tool.status === "failed") return <X size={14} aria-hidden />;
  return <CircleDashed size={14} aria-hidden />;
}

function ToolRow({ tool }: { tool: AssistantProcessTool }) {
  const [sourcesOverride, setSourcesOverride] = useState<boolean | null>(null);
  const isSearch = tool.toolId === "web.search";
  const sources = tool.sources;
  const sourcesOpen = sourcesOverride ?? (tool.status === "executing" && sources.length > 0);

  return (
    <div
      className="assistant-process-tool"
      data-status={tool.status}
      data-tool={tool.toolId}
    >
      <button
        type="button"
        className="assistant-process-tool-row"
        aria-expanded={sources.length > 0 ? sourcesOpen : undefined}
        disabled={sources.length === 0}
        onClick={() => setSourcesOverride(!sourcesOpen)}
      >
        <span className="assistant-process-tool-icon">
          {isSearch && tool.status !== "completed" && tool.status !== "failed" ? (
            <Globe2 size={14} aria-hidden />
          ) : (
            <ToolIcon tool={tool} />
          )}
        </span>
        <span className={cn("truncate", tool.status === "executing" && "assistant-process-active-label")}>
          {tool.label}
        </span>
        {tool.message && <span className="truncate text-[var(--color-text-tertiary)]">{tool.message}</span>}
        {sources.length > 0 && (
          <span className="ml-auto inline-flex items-center gap-1 text-[var(--color-text-tertiary)]">
            {sources.length} 个来源
            {sourcesOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
        )}
      </button>
      {tool.error && (
        <p className="assistant-process-error">{tool.error}</p>
      )}
      {sources.length > 0 && (
        <div className={cn("assistant-process-sources", !sourcesOpen && "is-collapsed")}>
          <div>
            {sources.map((source, index) => {
              const body = (
                <>
                  <span className="assistant-process-source-state">
                    {tool.status === "executing" && index === sources.length - 1 ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Check size={12} />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{source.title}</span>
                  {source.url && <span className="truncate text-[var(--color-text-tertiary)]">{hostOf(source.url)}</span>}
                  {source.url && <ExternalLink size={11} className="shrink-0" />}
                </>
              );
              return source.url ? (
                <a
                  key={`${source.url}-${index}`}
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="assistant-process-source"
                  style={{ "--source-delay": `${Math.min(index, 3) * 40}ms` } as CSSProperties}
                >
                  {body}
                </a>
              ) : (
                <div
                  key={`${source.title}-${index}`}
                  className="assistant-process-source"
                  style={{ "--source-delay": `${Math.min(index, 3) * 40}ms` } as CSSProperties}
                >
                  {body}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function AssistantProcess({
  trace,
  reasoningContent,
  isStreaming,
  hasResponse,
  onApprove,
  onDeny,
}: AssistantProcessProps) {
  const hasReasoning = Boolean(reasoningContent?.trim());
  const needsApproval = trace?.tools.some((tool) => tool.status === "awaiting_approval") ?? false;
  const running = isStreaming || trace?.status === "running";
  const [openOverride, setOpenOverride] = useState<boolean | null>(null);
  const open = openOverride ?? (needsApproval || (running && !hasResponse));

  const summary = useMemo(() => {
    if (needsApproval) return "等待你的确认";
    if (running && !hasResponse) return hasReasoning ? "正在思考" : "正在准备";
    if (running) return "正在整理回答";
    const parts = [];
    const elapsed = elapsedLabel(trace);
    if (elapsed) parts.push(`思考 ${elapsed}`);
    if (trace?.tools.length) parts.push(`使用 ${trace.tools.length} 个工具`);
    return parts.join(" · ") || "思考过程";
  }, [hasReasoning, hasResponse, needsApproval, running, trace]);

  const hasDetails = hasReasoning || Boolean(trace?.plan) || Boolean(trace?.tools.length);

  return (
    <section className="assistant-process" data-state={running ? "running" : trace?.status ?? "completed"}>
      <button
        type="button"
        className="assistant-process-header"
        onClick={() => hasDetails && setOpenOverride(!open)}
        aria-expanded={hasDetails ? open : undefined}
        disabled={!hasDetails}
      >
        {running ? (
          <LoadingIndicator
            size="sm"
            orb={trace?.tools.some((tool) => tool.toolId === "web.search" && tool.status === "executing") ? "searching" : "solving"}
            label={summary}
            className="assistant-process-loading"
          />
        ) : (
          <>
            <Check size={14} className="assistant-process-done" aria-hidden />
            <span>{summary}</span>
          </>
        )}
        {hasDetails && (
          <span className="ml-auto">{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>
        )}
      </button>

      <div className={cn("assistant-process-collapsible", !open && "is-collapsed")}>
        <div>
          <div className="assistant-process-body">
            {hasReasoning && (
              <div className="assistant-process-reasoning" aria-label="思考过程">
                {reasoningContent}
              </div>
            )}
            {trace?.plan && (
              <ol className="assistant-process-plan" aria-label={trace.plan.title}>
                {trace.plan.steps.map((step) => (
                  <li key={step.id} data-status={step.status}>
                    <span className="assistant-process-plan-icon">
                      {step.status === "completed" ? <Check size={13} /> : step.status === "in_progress" ? <Loader2 size={13} className="animate-spin" /> : step.status === "blocked" ? <X size={13} /> : <CircleDashed size={13} />}
                    </span>
                    <span>{step.title}</span>
                    {step.reason && <span className="text-[var(--color-text-tertiary)]">{step.reason}</span>}
                  </li>
                ))}
              </ol>
            )}
            {trace?.tools.map((tool) => (
              tool.status === "awaiting_approval" && tool.preview ? (
                <ApprovalCard
                  key={tool.executionId}
                  preview={tool.preview}
                  canApproveSession={tool.approval?.canApproveSession ?? false}
                  onApprove={(scope) => onApprove?.(tool.executionId, tool.approval?.token ?? "", scope)}
                  onDeny={() => onDeny?.(tool.executionId)}
                />
              ) : (
                <ToolRow key={tool.executionId} tool={tool} />
              )
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
