"use client";

import { CalendarCheck, Package, RotateCcw } from "lucide-react";
import { MasteryPill } from "@/components/learning/mastery-pill";
import { NextActionCard } from "@/components/learning/next-action-card";
import { cn } from "@/lib/utils";
import {
  MOCK_LEARNING_TODAY,
  MOCK_REVIEW_DUE,
  MOCK_STUDY_PACK,
  MOCK_WRONG_ANSWERS,
} from "@/lib/mock/landing-fixtures";

/**
 * 缩放版复习演示。纯 mock 数据驱动，不接 API。
 * 下一步卡片复用真实 NextActionCard，到期行复用真实 MasteryPill，
 * 行视觉复刻真实 ReviewQueue / 错题历史 / 资料包。
 */
export function LearningReviewDemo({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden rounded-[inherit] bg-[var(--color-panel)]",
        className
      )}
    >
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--color-border-light)] px-4">
        <div className="flex min-w-0 items-center gap-2">
          <CalendarCheck
            size={13}
            className="shrink-0 text-[var(--color-accent)]"
          />
          <span className="truncate text-[13px] font-medium text-[var(--color-text-primary)]">
            今天学什么
          </span>
        </div>
        <span className="shrink-0 rounded-full bg-[var(--color-surface-active)] px-2 py-1 text-[11px] text-[var(--color-text-secondary)]">
          到期复习
        </span>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-auto bg-[var(--color-bg)] px-4 py-5 sm:px-6">
        <NextActionCard entry={MOCK_LEARNING_TODAY} />

        <ul className="flex flex-col divide-y divide-[var(--color-border-light)]">
          {MOCK_REVIEW_DUE.map((entry) => (
            <li
              key={entry.id}
              className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2.5"
            >
              <span className="text-sm text-[var(--color-text-primary)]">
                {entry.name}
              </span>
              <MasteryPill state={entry.mastery} />
              <span className="inline-flex items-center gap-1 text-xs text-[var(--color-text-secondary)]">
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 rounded-full bg-[var(--color-warning)]"
                />
                到期
              </span>
            </li>
          ))}
        </ul>

        <div className="space-y-3 border-t border-[var(--color-border-light)] pt-4">
          <p className="flex items-start gap-2 text-[12px] leading-relaxed text-[var(--color-text-secondary)]">
            <RotateCcw
              size={13}
              className="mt-0.5 shrink-0 text-[var(--color-text-tertiary)]"
            />
            <span>
              错题 {MOCK_WRONG_ANSWERS.unresolved} 道待重做：
              {MOCK_WRONG_ANSWERS.sample}
            </span>
          </p>
          <p className="flex items-start gap-2 text-[12px] leading-relaxed text-[var(--color-text-secondary)]">
            <Package
              size={13}
              className="mt-0.5 shrink-0 text-[var(--color-text-tertiary)]"
            />
            <span>
              资料包「{MOCK_STUDY_PACK.title}」已生成{" "}
              {MOCK_STUDY_PACK.sectionCount} 个小节，可发布为成果导出
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}
