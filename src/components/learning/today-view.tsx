"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { useLearningToday } from "@/lib/hooks/use-learning-today";
import type {
  LearningTodayGoalDto,
  TodayNextActionType,
} from "@/lib/hooks/use-learning-api";
import { EmptyState } from "@/components/learning/empty-state";
import { NextActionCard } from "@/components/learning/next-action-card";
import { LearningProgressSummary } from "@/components/learning/progress-summary";
import { Button } from "@/components/ui/button";

export interface TodayViewProps {
  className?: string;
}

/** Lower number wins when picking the single next action for the day. */
const NEXT_ACTION_PRIORITY: Record<TodayNextActionType, number> = {
  review: 0,
  start_diagnostic: 1,
  generate_map: 2,
  confirm_scope: 3,
  continue_learning: 4,
};

/**
 * The main card promotes the highest-priority next action across all goals
 * (review first, continue_learning only when nothing else is pending); ties
 * resolve to the first goal in server order.
 */
function pickMainEntry(
  goals: LearningTodayGoalDto[]
): LearningTodayGoalDto | null {
  if (goals.length === 0) {
    return null;
  }
  return goals.reduce((best, entry) =>
    NEXT_ACTION_PRIORITY[entry.nextAction.type] <
    NEXT_ACTION_PRIORITY[best.nextAction.type]
      ? entry
      : best
  );
}

/**
 * Today view for the learning loop: the single next action on top, then one
 * row per active goal. The page-level heading belongs to page.tsx, so this
 * component renders no h1.
 */
export function TodayView({ className }: TodayViewProps) {
  const { data, isPending, isError, refetch } = useLearningToday();

  if (isPending) {
    return (
      <div
        role="status"
        className={cn(
          "px-1 py-8 text-sm text-[var(--color-text-secondary)]",
          className
        )}
      >
        加载中…
      </div>
    );
  }

  if (isError) {
    return (
      <EmptyState
        className={className}
        title="今日学习加载失败"
        description="请检查网络后重试。"
        action={
          <Button onClick={() => refetch()}>
            重试
          </Button>
        }
      />
    );
  }

  const goals = data?.goals ?? [];

  if (goals.length === 0) {
    return (
      <EmptyState
        className={className}
        title="今天没有安排的学习任务"
        description="从一个现有项目开始学习"
        action={
          <Button asChild>
            <Link href="/projects">查看项目</Link>
          </Button>
        }
      />
    );
  }

  const mainEntry = pickMainEntry(goals);

  return (
    <div className={cn("flex flex-col gap-6", className)}>
      {mainEntry && <NextActionCard entry={mainEntry} />}
      <ul className="flex flex-col gap-5">
        {goals.map(({ goal, project, summary }) => (
          <li key={goal.id} className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[var(--color-text-primary)]">
                  {goal.title}
                </p>
                <p className="text-xs text-[var(--color-text-tertiary)]">
                  {project.name}
                </p>
              </div>
              <Button asChild variant="ghost">
                <Link
                  href={`/projects/${project.id}/learning?goal=${encodeURIComponent(goal.id)}`}
                >
                  进入学习
                </Link>
              </Button>
            </div>
            <LearningProgressSummary summary={summary} />
          </li>
        ))}
      </ul>
    </div>
  );
}
