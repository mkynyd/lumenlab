import { cn } from "@/lib/utils";

interface ProgressProps {
  value: number; // 0–100
  size?: "sm" | "md";
  color?: "accent" | "success" | "warning" | "error";
  className?: string;
  showLabel?: boolean;
  label?: string;
}

const colorMap = {
  accent: "bg-[var(--color-accent)]",
  success: "bg-[var(--color-success)]",
  warning: "bg-[var(--color-warning)]",
  error: "bg-[var(--color-error)]",
};

export function Progress({
  value,
  size = "md",
  color = "accent",
  className,
  showLabel = false,
  label,
}: ProgressProps) {
  const clampedValue = Math.min(100, Math.max(0, value));
  const height = size === "sm" ? "h-1" : "h-1.5";

  return (
    <div className={cn("w-full", className)}>
      <div
        className={cn(
          "w-full rounded-full overflow-hidden",
          height,
          "bg-[var(--color-ring-track)]"
        )}
        role="progressbar"
        aria-valuenow={clampedValue}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label || `${clampedValue}%`}
      >
        <div
          className={cn(
            height,
            "rounded-full transition-[width] duration-300 ease-out",
            colorMap[color]
          )}
          style={{ width: `${clampedValue}%` }}
        />
      </div>
      {showLabel && (
        <span className="text-xs text-[var(--color-text-secondary)] mt-1 font-mono">
          {label || `${Math.round(clampedValue)}%`}
        </span>
      )}
    </div>
  );
}
