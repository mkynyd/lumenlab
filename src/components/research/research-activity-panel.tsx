"use client";

import { Check, Circle, Globe, Page, Search, Xmark } from "iconoir-react";
import { Button } from "@/components/ui/button";
import type { ResearchSourceView } from "@/lib/research/research-view-model";

interface ResearchActivityEvent {
  kind?: string;
  message?: string;
  createdAt?: string;
  publicData?: {
    queries?: string[];
    query?: string;
    provider?: string;
  };
}

function activityIcon(kind: string | undefined) {
  if (kind?.includes("search")) return <Search width={16} height={16} />;
  if (kind?.includes("source") || kind?.includes("fetch")) return <Globe width={16} height={16} />;
  if (kind?.includes("report") || kind?.includes("synthesis")) return <Page width={16} height={16} />;
  if (kind?.includes("complete")) return <Check width={16} height={16} />;
  return <Circle width={16} height={16} />;
}

function sourceHost(source: ResearchSourceView): string | null {
  if (!source.url) return null;
  try {
    return new URL(source.url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function ResearchActivityPanel({
  stageLabel,
  liveMessage,
  events,
  sources,
  onClose,
}: {
  stageLabel: string;
  liveMessage: string;
  events: ResearchActivityEvent[];
  sources: ResearchSourceView[];
  onClose: () => void;
}) {
  const recentSources = sources.slice(0, 8);
  const visibleEvents = events.slice(0, 12);

  return (
    <aside aria-label={`研究活动：${stageLabel}`} className="min-w-0 rounded-[var(--radius-lg)] bg-[var(--color-panel-muted)] px-5 py-5 xl:sticky xl:top-6 xl:max-h-[calc(100dvh-3rem)] xl:overflow-y-auto">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">实时记录</p>
          <h2 className="mt-1 truncate text-base font-semibold text-[var(--color-text-primary)]">研究活动</h2>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="关闭研究活动" onClick={onClose}>
          <Xmark width={16} height={16} />
        </Button>
      </div>

      <div className="mt-5 flex items-start gap-3">
        <span className="mt-0.5 text-[var(--color-accent)]" aria-hidden="true"><Circle width={16} height={16} /></span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--color-text-primary)]">当前阶段</p>
          <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">{liveMessage || "正在按研究计划检索、阅读与核验证据。"}</p>
        </div>
      </div>

      {visibleEvents.length > 0 ? (
        <ol className="mt-5 space-y-4" aria-label="公开研究事件">
          {visibleEvents.map((event, index) => {
            const detail = event.publicData?.queries?.join(" · ") ?? event.publicData?.query;
            return (
              <li key={`${event.createdAt ?? "event"}-${index}`} className="flex items-start gap-3">
                <span className="mt-0.5 text-[var(--color-text-tertiary)]" aria-hidden="true">{activityIcon(event.kind)}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs leading-5 text-[var(--color-text-primary)]">{event.message ?? event.kind ?? "研究进度已更新"}</p>
                  {detail ? <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-[var(--color-text-tertiary)]">{detail}</p> : null}
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="mt-5 text-xs leading-5 text-[var(--color-text-tertiary)]">新的检索、阅读和报告事件会出现在这里。</p>
      )}

      {recentSources.length > 0 ? (
        <div className="mt-7">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xs font-medium text-[var(--color-text-primary)]">研究来源</h3>
            <span className="text-[11px] tabular-nums text-[var(--color-text-tertiary)]">{sources.length}</span>
          </div>
          <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="最近读取来源">
            {recentSources.map((source) => (
              <li key={source.id} className="max-w-full rounded-full bg-[var(--color-bg)] px-2.5 py-1 text-[11px] text-[var(--color-text-secondary)]">
                <span className="block max-w-44 truncate">{sourceHost(source) ?? source.title}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </aside>
  );
}
