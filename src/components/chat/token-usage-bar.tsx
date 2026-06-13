import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface TokenUsageBarProps {
  used: number;
  total?: number;
  cacheHit?: number;
  className?: string;
}

const MAX_CONTEXT = 1_000_000; // 1M 上下文窗口

export function TokenUsageBar({
  used,
  total = MAX_CONTEXT,
  cacheHit = 0,
  className,
}: TokenUsageBarProps) {
  const percent = (used / total) * 100;
  const color = percent >= 90 ? "error" : percent >= 75 ? "warning" : "accent";

  function fmt(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  }

  return (
    <div className={cn("space-y-1", className)}>
      <Progress value={percent} size="sm" color={color} />
      <div className="flex items-center justify-between text-[11px] font-mono">
        <span className="text-[var(--color-text-secondary)]">
          {fmt(used)} / {fmt(total)} tokens
          {cacheHit > 0 && (
            <span className="text-[var(--color-success)] ml-2">
              {fmt(cacheHit)} 缓存命中
            </span>
          )}
        </span>
        <span
          className={cn(
            "tabular-nums",
            percent >= 90
              ? "text-[var(--color-error)]"
              : "text-[var(--color-text-tertiary)]"
          )}
        >
          {percent.toFixed(1)}%
        </span>
      </div>
    </div>
  );
}
