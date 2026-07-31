import { cn } from "@/lib/utils";
import type { MasteryState } from "@/lib/learning/contracts";

export interface LearningProgressBarProps {
  mastery: Record<MasteryState, number>;
  /** Defaults to the sum of the three mastery buckets. */
  totalPoints?: number;
  /** When > 0, a due badge is shown to the right of the track. */
  dueCount?: number;
  freshness?: {
    needsRevalidation: number;
    unsupported: number;
  };
  className?: string;
}

interface Segment {
  state: MasteryState;
  colorClass: string;
}

const SEGMENTS: Segment[] = [
  { state: "mastered", colorClass: "bg-[var(--color-success)]" },
  { state: "learning", colorClass: "bg-[var(--color-accent)]" },
  { state: "new", colorClass: "bg-[var(--color-ring-track)]" },
];

/**
 * Segmented mastery bar: three flat segments (mastered / learning / new),
 * an optional due badge, and an optional neutral freshness legend. The
 * whole figure carries role="img" with a fully spelled-out aria-label, so
 * decorative inner text is not relied on for accessibility.
 */
export function LearningProgressBar({
  mastery,
  totalPoints,
  dueCount = 0,
  freshness,
  className,
}: LearningProgressBarProps) {
  const total = totalPoints ?? mastery.new + mastery.learning + mastery.mastered;

  if (total <= 0) {
    return (
      <div
        className={cn("w-full", className)}
        role="img"
        aria-label="还没有知识点"
      >
        <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-ring-track)]" />
        <p className="mt-2 text-xs text-[var(--color-text-tertiary)]">
          还没有知识点
        </p>
      </div>
    );
  }

  let ariaLabel = `共 ${total} 个知识点：${mastery.mastered} 已掌握、${mastery.learning} 学习中、${mastery.new} 未开始`;
  if (dueCount > 0) {
    ariaLabel += `，${dueCount} 个待复习`;
  }
  const freshnessParts: string[] = [];
  if (freshness && freshness.needsRevalidation > 0) {
    freshnessParts.push(`${freshness.needsRevalidation} 个资料待更新`);
  }
  if (freshness && freshness.unsupported > 0) {
    freshnessParts.push(`${freshness.unsupported} 个资料不可用`);
  }
  if (freshnessParts.length > 0) {
    ariaLabel += `，${freshnessParts.join("、")}`;
  }

  const showLegend = freshnessParts.length > 0 && freshness != null;

  return (
    <div
      className={cn("w-full", className)}
      role="img"
      aria-label={ariaLabel}
    >
      <div className="flex items-center gap-2">
        <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-[var(--color-ring-track)]">
          {SEGMENTS.map(({ state, colorClass }) => (
            <div
              key={state}
              data-state={state}
              className={cn(
                "h-full transition-[width] duration-200 motion-reduce:transition-none",
                colorClass
              )}
              style={{ width: `${(mastery[state] / total) * 100}%` }}
            />
          ))}
        </div>
        {dueCount > 0 && (
          <span className="flex shrink-0 items-center gap-1 text-xs text-[var(--color-text-secondary)]">
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 rounded-full bg-[var(--color-warning)]"
            />
            {dueCount} 待复习
          </span>
        )}
      </div>
      {showLegend && (
        <div className="mt-1.5 flex items-center gap-3 text-xs text-[var(--color-text-tertiary)]">
          {freshness.needsRevalidation > 0 && (
            <span className="flex items-center gap-1">
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 rounded-full bg-[var(--color-warning)] opacity-45"
              />
              {freshness.needsRevalidation} 资料待更新
            </span>
          )}
          {freshness.unsupported > 0 && (
            <span className="flex items-center gap-1">
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 rounded-full bg-[var(--color-text-tertiary)] opacity-35"
              />
              {freshness.unsupported} 资料不可用
            </span>
          )}
        </div>
      )}
    </div>
  );
}
