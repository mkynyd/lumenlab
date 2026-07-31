import { cn } from "@/lib/utils";
import type { MasteryState } from "@/lib/learning/contracts";

export interface MasteryPillProps {
  state: MasteryState;
  className?: string;
}

const STATE_STYLES: Record<MasteryState, { label: string; className: string }> = {
  mastered: {
    label: "已掌握",
    className: "bg-[var(--color-success-muted)] text-[var(--color-success)]",
  },
  learning: {
    label: "学习中",
    className: "bg-[var(--color-accent-muted)] text-[var(--color-accent)]",
  },
  new: {
    label: "未开始",
    className:
      "bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]",
  },
};

/** Flat pill for a knowledge point's mastery state. No borders, no ring. */
export function MasteryPill({ state, className }: MasteryPillProps) {
  const { label, className: stateClassName } = STATE_STYLES[state];

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        stateClassName,
        className
      )}
    >
      {label}
    </span>
  );
}
