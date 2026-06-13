import { cn } from "@/lib/utils";

interface CostDisplayProps {
  inputTokens: number;
  outputTokens: number;
  cacheHitTokens?: number;
  cacheMissTokens?: number;
  model: "deepseek-v4-pro" | "deepseek-v4-flash";
  className?: string;
}

// 每百万 Token 价格（人民币）
const PRICING = {
  "deepseek-v4-pro": {
    inputCacheHit: 0.025,
    inputCacheMiss: 3.0,
    output: 6.0,
    label: "Pro",
  },
  "deepseek-v4-flash": {
    inputCacheHit: 0.02,
    inputCacheMiss: 1.0,
    output: 2.0,
    label: "Flash",
  },
};

export function CostDisplay({
  inputTokens,
  outputTokens,
  cacheHitTokens = 0,
  cacheMissTokens = 0,
  model,
  className,
}: CostDisplayProps) {
  const pricing = PRICING[model];

  const inputCacheHitCost = (cacheHitTokens / 1_000_000) * pricing.inputCacheHit;
  const inputCacheMissCost =
    (cacheMissTokens / 1_000_000) * pricing.inputCacheMiss;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  const totalCost = inputCacheHitCost + inputCacheMissCost + outputCost;

  function fmt(n: number): string {
    if (n >= 1) return `¥${n.toFixed(2)}`;
    if (n >= 0.01) return `¥${n.toFixed(4)}`;
    return `¥${n.toFixed(6)}`;
  }

  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--color-text-secondary)]">
          预估费用 · {pricing.label}
        </span>
        <span className="text-xs font-mono font-medium tabular-nums text-[var(--color-text-primary)]">
          {fmt(totalCost)}
        </span>
      </div>
      <div className="flex gap-2 text-[10px] font-mono text-[var(--color-text-tertiary)]">
        <span>输入:{fmt(inputCacheHitCost + inputCacheMissCost)}</span>
        <span>输出:{fmt(outputCost)}</span>
        {cacheHitTokens > 0 && (
          <span className="text-[var(--color-success)]">
            节省:{fmt(inputCacheHitCost)}
          </span>
        )}
      </div>
    </div>
  );
}
