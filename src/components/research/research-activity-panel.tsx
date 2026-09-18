"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
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

const COLLAPSED_SOURCE_COUNT = 6;

/** 水合检测用的空订阅（同 theme-toggle）。 */
const subscribeToHydration = () => () => undefined;

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

/**
 * 研究活动滑出面板（进行中状态的右侧记录）：当前阶段 + 公开事件流 +
 * 研究来源 chip 列表。结构对齐参考 UI 的右侧研究来源/状态面板。
 *
 * 标题固定为「研究活动」：研究目标已在主卡展示，这里不再重复；
 * Escape 关闭，打开时焦点移入关闭按钮，关闭后由调用方还回触发按钮。
 */
export function ResearchActivityPanel({
  stageLabel,
  events,
  sources,
  onClose,
}: {
  stageLabel: string;
  events: ResearchActivityEvent[];
  sources: ResearchSourceView[];
  onClose: () => void;
}) {
  const [sourcesExpanded, setSourcesExpanded] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  // portal 到 body：避免被工作台主内容的动画层叠上下文困住（同阅读器）。
  // useSyncExternalStore 水合检测（同 theme-toggle），避免 effect 内同步 setState。
  const mounted = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );

  useEffect(() => {
    closeButtonRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const visibleEvents = events.slice(0, 12);
  const visibleSources = sourcesExpanded ? sources : sources.slice(0, COLLAPSED_SOURCE_COUNT);
  const hiddenSources = sources.length - visibleSources.length;

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-y-0 right-0 z-[60] flex w-full justify-end sm:w-[22rem]">
      <aside
        aria-label={`研究活动：${stageLabel}`}
        className="h-full w-full overflow-y-auto overscroll-contain bg-[var(--color-panel)] px-5 py-5 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-[var(--color-text-primary)]">研究活动</h2>
          <Button ref={closeButtonRef} type="button" variant="ghost" size="icon-sm" aria-label="关闭研究活动" onClick={onClose}>
            <Xmark width={16} height={16} />
          </Button>
        </div>

        <section aria-label="研究阶段" className="mt-6">
          <div className="flex items-start gap-3">
            <span className="mt-1 inline-flex size-2 shrink-0 rounded-full bg-[var(--color-accent)]" aria-hidden="true" />
            <p className="text-sm font-medium text-[var(--color-text-primary)]">{stageLabel}</p>
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
            <p className="mt-4 text-xs leading-5 text-[var(--color-text-tertiary)]">新的检索、阅读和报告事件会出现在这里。</p>
          )}
        </section>

        {sources.length > 0 ? (
          <section aria-label="研究来源" className="mt-7">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-xs font-medium text-[var(--color-text-primary)]">研究来源</h3>
              <span className="text-[11px] tabular-nums text-[var(--color-text-tertiary)]">{sources.length}</span>
            </div>
            <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="最近读取来源">
              {visibleSources.map((source) => (
                <li key={source.id} className="max-w-full rounded-full bg-[var(--color-panel-muted)] px-2.5 py-1 text-[11px] text-[var(--color-text-secondary)]">
                  <span className="block max-w-44 truncate">{sourceHost(source) ?? source.title}</span>
                </li>
              ))}
            </ul>
            {hiddenSources > 0 ? (
              <button
                type="button"
                onClick={() => setSourcesExpanded(true)}
                className="mt-3 rounded-[var(--radius-sm)] px-1 py-0.5 text-[11px] text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
              >
                再显示 {hiddenSources} 个
              </button>
            ) : null}
          </section>
        ) : null}
      </aside>
    </div>,
    document.body,
  );
}
