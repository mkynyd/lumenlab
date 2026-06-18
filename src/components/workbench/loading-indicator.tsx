"use client";

import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";

type LoadingVariant = "lissajous" | "rose" | "orbit";

interface LoadingIndicatorProps {
  label?: string;
  detail?: string;
  variant?: LoadingVariant;
  size?: "sm" | "md" | "lg";
  speed?: "calm" | "normal" | "fast";
  className?: string;
}

export function LoadingIndicator({
  label = "正在计算",
  detail,
  variant = "lissajous",
  size = "md",
  speed = "calm",
  className,
}: LoadingIndicatorProps) {
  void variant;

  return (
    <div
      className={cn("loading-indicator-status", className)}
      role="status"
      aria-live="polite"
      aria-label={detail ? `${label}，${detail}` : label}
    >
      <Spinner
        className={cn(
          "loading-indicator-spinner text-primary",
          size === "sm" && "size-4",
          size === "md" && "size-5",
          size === "lg" && "size-7",
          speed === "calm" && "duration-1000",
          speed === "normal" && "duration-700",
          speed === "fast" && "duration-500"
        )}
        aria-hidden="true"
      />
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium text-[var(--color-text-primary)]">
          {label}
        </span>
        {detail && (
          <span className="block truncate text-[11px] text-[var(--color-text-tertiary)]">
            {detail}
          </span>
        )}
      </span>
    </div>
  );
}
