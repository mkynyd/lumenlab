"use client";

import { NavArrowRight } from "iconoir-react";
import {
  researchGraphProvenanceLabel,
  researchSourceBadges,
  type ResearchSourceView,
} from "@/lib/research/research-view-model";

const badgeToneClass: Record<string, string> = {
  neutral: "bg-[var(--color-bg)] text-[var(--color-text-tertiary)]",
  accent: "bg-[var(--color-interaction-selected)] text-[var(--color-accent)]",
  caution: "bg-[var(--color-info-muted)] text-[var(--color-warning)]",
};

/**
 * 来源清单：按 canonical ResearchSource 去重，并区分 Web / 学术论文 / 项目资料 /
 * 引用图发现 / 仅摘要元数据 / 全文片段 / 图表观察。本轮不做节点连线图。
 */
export function ResearchSourcesPanel({
  sources,
  selectedSourceId,
  onSelectSource,
}: {
  sources: ResearchSourceView[];
  selectedSourceId: string | null;
  onSelectSource: (sourceId: string | null) => void;
}) {
  if (sources.length === 0) {
    return (
      <section aria-label="研究来源" className="bg-[var(--color-panel)] px-5 py-5">
        <h2 className="text-base font-semibold text-[var(--color-text-primary)]">来源</h2>
        <p className="mt-2 text-xs leading-5 text-[var(--color-text-tertiary)]">当前 Run 还没有已读取的来源。</p>
      </section>
    );
  }
  const selected = selectedSourceId ? sources.find((source) => source.id === selectedSourceId) ?? null : null;
  return (
    <section aria-label="研究来源" className="bg-[var(--color-panel)] px-5 py-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-[var(--color-text-primary)]">来源</h2>
        <span className="text-xs text-[var(--color-text-tertiary)]">{sources.length} 个独立来源（按论文/页面归并）</span>
      </div>
      <ul role="list" className="mt-4 grid gap-2 lg:grid-cols-2">
        {sources.map((source) => {
          const isSelected = selectedSourceId === source.id;
          return (
            <li key={source.id} role="listitem">
              <button
                type="button"
                aria-pressed={isSelected}
                onClick={() => onSelectSource(isSelected ? null : source.id)}
                className={`block w-full rounded-[var(--radius-md)] px-3 py-3 text-left ${isSelected ? "bg-[var(--color-interaction-selected)]" : "bg-[var(--color-bg)] hover:bg-[var(--color-surface-hover)]"}`}
              >
                <span className="block truncate text-xs font-medium text-[var(--color-text-primary)]">{source.title}</span>
                <span className="mt-1 block truncate text-[11px] text-[var(--color-text-tertiary)]">
                  {[source.authors.length > 0 ? source.authors.slice(0, 3).join(", ") : null, source.year ?? null, source.venue]
                    .filter(Boolean)
                    .join(" · ") || "无作者/年份元数据"}
                </span>
                <span className="mt-2 flex flex-wrap gap-1">
                  {researchSourceBadges(source).map((badge) => (
                    <span key={badge.label} className={`rounded-full px-2 py-0.5 text-[10px] ${badgeToneClass[badge.tone]}`}>{badge.label}</span>
                  ))}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {selected ? (
        <div className="mt-4 rounded-[var(--radius-md)] bg-[var(--color-bg)] px-4 py-4">
          <p className="text-sm font-medium leading-6 text-[var(--color-text-primary)]">{selected.title}</p>
          <div className="mt-2 space-y-1 text-[11px] leading-5 text-[var(--color-text-tertiary)]">
            {selected.authors.length > 0 ? <p>作者：{selected.authors.join(", ")}</p> : null}
            {selected.year !== null ? <p>年份：{selected.year}</p> : null}
            {selected.venue ? <p>发表载体：{selected.venue}</p> : null}
            {selected.doi ? <p>DOI：{selected.doi}</p> : null}
            <p>本次 Run 关联 Evidence：{selected.evidenceCount} 条</p>
            {selected.isGraphDiscovered
              ? <p>发现方式：{selected.graphRelations.map(researchGraphProvenanceLabel).join(" · ")}</p>
              : <p>发现方式：直接检索</p>}
          </div>
          {selected.url ? (
            <a href={selected.url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs text-[var(--color-accent)] hover:underline">
              打开来源 <NavArrowRight width={13} height={13} />
            </a>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
