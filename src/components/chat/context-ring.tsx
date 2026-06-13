import { ProgressRing } from "@/components/ui/progress-ring";
import { cn } from "@/lib/utils";

interface ContextRingProps {
  used: number;
  total?: number;
  className?: string;
}

const MAX_CONTEXT = 1_000_000;

export function ContextRing({
  used,
  total = MAX_CONTEXT,
  className,
}: ContextRingProps) {
  const percent = (used / total) * 100;

  function fmt(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  }

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <ProgressRing value={percent} size={48} strokeWidth={3} />
      <div>
        <p className="text-xs font-medium text-[var(--color-text-primary)]">
          上下文窗口
        </p>
        <p className="text-[11px] font-mono text-[var(--color-text-secondary)]">
          {fmt(used)} / {fmt(total)}
        </p>
      </div>
    </div>
  );
}
