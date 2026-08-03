"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  useCreateReviewSession,
  useReviewQueue,
} from "@/lib/hooks/use-learning-progress";
import { createIdempotencyKey } from "@/lib/hooks/use-learning-api";
import { EmptyState } from "@/components/learning/empty-state";
import { FreshnessBadge } from "@/components/learning/freshness-badge";
import { MasteryPill } from "@/components/learning/mastery-pill";
import { Button } from "@/components/ui/button";

export interface ReviewQueueProps {
  projectId: string;
  goalId: string;
  className?: string;
}

/**
 * Review queue for one goal. The server only returns due entries, so they
 * are listed in place with no scheduled section. The primary action creates
 * a review session and jumps straight into it.
 */
export function ReviewQueue({ projectId, goalId, className }: ReviewQueueProps) {
  const router = useRouter();
  const {
    data: entries,
    isPending,
    isError,
    refetch,
  } = useReviewQueue(projectId, goalId);
  const createSession = useCreateReviewSession(projectId, goalId);
  const reviewKeyRef = useRef<string | null>(null);

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
        title="复习队列加载失败"
        description="请稍后重试。"
        action={
          <Button type="button" variant="secondary" onClick={() => refetch()}>
            重试
          </Button>
        }
      />
    );
  }

  const due = entries ?? [];

  if (due.length === 0) {
    return <EmptyState className={className} title="暂时没有复习任务" />;
  }

  const startReview = () => {
    if (!reviewKeyRef.current) {
      reviewKeyRef.current = createIdempotencyKey();
    }
    createSession.mutate(
      { limit: 10, idempotencyKey: reviewKeyRef.current },
      {
        onSuccess: (data) => {
          reviewKeyRef.current = null;
          if (data?.session) {
            router.push(
              `/learning?project=${encodeURIComponent(projectId)}&session=${encodeURIComponent(data.session.id)}`
            );
          }
        },
      }
    );
  };

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="flex items-center gap-3">
        <Button
          onClick={startReview}
          disabled={createSession.isPending}
        >
          {createSession.isPending ? "创建中…" : "开始复习"}
        </Button>
        {createSession.isError && (
          <p role="alert" className="workbench-view-enter text-xs text-[var(--color-error)]">
            创建复习会话失败，请重试。
          </p>
        )}
      </div>

      <ul className="flex flex-col divide-y divide-[var(--color-border-light)]">
        {due.map((entry) => (
          <li
            key={entry.lineageId}
            className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2.5"
          >
            <span className="text-sm text-[var(--color-text-primary)]">
              {entry.name}
            </span>
            <MasteryPill state={entry.masteryState} />
            <FreshnessBadge freshness={entry.freshness} />
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
    </div>
  );
}
