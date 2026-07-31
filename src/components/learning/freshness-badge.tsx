import { cn } from "@/lib/utils";
import type { ContentFreshness } from "@/lib/learning/contracts";

export interface FreshnessBadgeProps {
  freshness: ContentFreshness;
  className?: string;
}

/**
 * Content-freshness hint. Current content renders nothing; the other two
 * states are plain text with an optional status dot, no borders.
 */
export function FreshnessBadge({ freshness, className }: FreshnessBadgeProps) {
  if (freshness === "current") {
    return null;
  }

  if (freshness === "needs_revalidation") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 text-xs text-[var(--color-text-secondary)]",
          className
        )}
      >
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 rounded-full bg-[var(--color-warning)]"
        />
        资料待更新
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs text-[var(--color-text-tertiary)]",
        className
      )}
    >
      资料不可用
    </span>
  );
}
