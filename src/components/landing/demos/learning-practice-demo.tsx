"use client";

import { ClipboardList } from "lucide-react";
import { PracticeFeedback } from "@/components/learning/practice-feedback";
import { PracticeItemCard } from "@/components/learning/practice-item-card";
import { cn } from "@/lib/utils";
import {
  MOCK_ATTEMPT_RESULT,
  MOCK_LEARNING_GOAL,
  MOCK_PRACTICE_ITEM,
} from "@/lib/mock/landing-fixtures";

/**
 * 缩放版诊断练习演示。纯 mock 数据驱动，不接 API。
 * 题卡与提交后反馈直接复用真实 PracticeItemCard / PracticeFeedback 组件，
 * 输入控件 disabled，纯展示。
 */
export function LearningPracticeDemo({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden rounded-[inherit] bg-[var(--color-panel)]",
        className
      )}
    >
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--color-border-light)] px-4">
        <div className="flex min-w-0 items-center gap-2">
          <ClipboardList
            size={13}
            className="shrink-0 text-[var(--color-accent)]"
          />
          <span className="truncate text-[13px] font-medium text-[var(--color-text-primary)]">
            {MOCK_LEARNING_GOAL.title}
          </span>
        </div>
        <span className="shrink-0 rounded-full bg-[var(--color-surface-active)] px-2 py-1 text-[11px] text-[var(--color-text-secondary)]">
          诊断练习
        </span>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-auto bg-[var(--color-bg)] px-4 py-5 sm:px-6">
        <PracticeItemCard
          item={MOCK_PRACTICE_ITEM}
          value="opt-a"
          onChange={() => {}}
          disabled
        />

        <div className="border-t border-[var(--color-border-light)] pt-5">
          <PracticeFeedback result={MOCK_ATTEMPT_RESULT} />
        </div>
      </div>
    </div>
  );
}
