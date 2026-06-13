import { cn } from "@/lib/utils";

interface ProgressRingProps {
  value: number; // 0–100
  size?: number; // diameter in px
  strokeWidth?: number;
  className?: string;
  label?: string;
  showLabel?: boolean;
}

export function ProgressRing({
  value,
  size = 64,
  strokeWidth = 4,
  className,
  label,
  showLabel = false,
}: ProgressRingProps) {
  const clampedValue = Math.min(100, Math.max(0, value));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clampedValue / 100) * circumference;

  // Color based on usage percentage
  let color = "var(--color-accent)";
  if (clampedValue >= 90) color = "var(--color-error)";
  else if (clampedValue >= 75) color = "var(--color-warning)";
  else if (clampedValue >= 50) color = "var(--color-accent)";

  return (
    <div
      className={cn("relative inline-flex items-center justify-center", className)}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        role="progressbar"
        aria-valuenow={clampedValue}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label || `${Math.round(clampedValue)}%`}
      >
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-ring-track)"
          strokeWidth={strokeWidth}
        />
        {/* Fill */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-300 ease-out"
        />
      </svg>
      {/* Center content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {showLabel && (
          <>
            <span className="text-xs font-mono font-medium text-[var(--color-text-primary)] leading-tight">
              {Math.round(clampedValue)}
            </span>
            <span className="text-[10px] text-[var(--color-text-tertiary)] leading-tight">
              %
            </span>
          </>
        )}
      </div>
    </div>
  );
}
