import { cn } from "@/lib/utils";
import type { LearningProgressSummaryDto } from "@/lib/hooks/use-learning-api";
import { LearningProgressBar } from "@/components/learning/progress-bar";

export interface LearningProgressSummaryProps {
  summary: LearningProgressSummaryDto;
  className?: string;
}

/**
 * Progress overview for one learning goal: the segmented bar (which also
 * carries the due badge and the freshness hint line) plus a plain text row
 * with the per-state counts.
 */
export function LearningProgressSummary({
  summary,
  className,
}: LearningProgressSummaryProps) {
  return (
    <div className={cn("w-full", className)}>
      <LearningProgressBar
        mastery={{
          new: summary.new,
          learning: summary.learning,
          mastered: summary.mastered,
        }}
        totalPoints={summary.total}
        dueCount={summary.due}
        freshness={{
          needsRevalidation: summary.needsRevalidation,
          unsupported: summary.unsupported,
        }}
      />
      <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
        已掌握 {summary.mastered} · 学习中 {summary.learning} · 未开始 {summary.new}
      </p>
    </div>
  );
}
