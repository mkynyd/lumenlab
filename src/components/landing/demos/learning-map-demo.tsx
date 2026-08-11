"use client";

import { Target } from "lucide-react";
import { KnowledgeMapView } from "@/components/learning/knowledge-map-view";
import { MasteryPill } from "@/components/learning/mastery-pill";
import { cn } from "@/lib/utils";
import {
  MOCK_LEARNING_GOAL,
  MOCK_LEARNING_MAP,
} from "@/lib/mock/landing-fixtures";

/**
 * 缩放版知识点地图演示。纯 mock 数据驱动，不接 API。
 * 地图列表直接复用真实 KnowledgeMapView 组件，
 * 掌握度概览复用真实 MasteryPill。
 */
export function LearningMapDemo({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden rounded-[inherit] bg-[var(--color-panel)]",
        className
      )}
    >
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--color-border-light)] px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Target size={13} className="shrink-0 text-[var(--color-accent)]" />
          <span className="truncate text-[13px] font-medium text-[var(--color-text-primary)]">
            {MOCK_LEARNING_GOAL.title}
          </span>
        </div>
        <span className="shrink-0 rounded-full bg-[var(--color-surface-active)] px-2 py-1 text-[11px] text-[var(--color-text-secondary)]">
          知识点地图
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-3 border-b border-[var(--color-border-light)] px-4 py-2.5 text-[11px] text-[var(--color-text-secondary)]">
        <span className="inline-flex items-center gap-1.5">
          <MasteryPill state="mastered" />1
        </span>
        <span className="inline-flex items-center gap-1.5">
          <MasteryPill state="learning" />3
        </span>
        <span className="inline-flex items-center gap-1.5">
          <MasteryPill state="new" />1
        </span>
        <span className="ml-auto tabular-nums text-[var(--color-text-tertiary)]">
          3 个知识点到期复习
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-[var(--color-bg)] px-4 py-4 sm:px-5">
        <KnowledgeMapView map={MOCK_LEARNING_MAP} />
      </div>
    </div>
  );
}
