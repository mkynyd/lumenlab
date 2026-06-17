"use client";

import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

type LoadingVariant = "lissajous" | "rose" | "orbit";

interface LoadingIndicatorProps {
  label?: string;
  detail?: string;
  variant?: LoadingVariant;
  size?: "sm" | "md" | "lg";
  speed?: "calm" | "normal" | "fast";
  className?: string;
}

const particleIndexes = [0, 1, 2, 3, 4, 5];

export function LoadingIndicator({
  label = "正在计算",
  detail,
  variant = "lissajous",
  size = "md",
  speed = "calm",
  className,
}: LoadingIndicatorProps) {
  const speedMap = {
    calm: "3.25s",
    normal: "2.65s",
    fast: "2.1s",
  };

  return (
    <div
      className={cn("loading-indicator-status", className)}
      role="status"
      aria-live="polite"
      aria-label={detail ? `${label}，${detail}` : label}
    >
      <div
        className={cn("loading-indicator", `loading-indicator-${size}`)}
        data-variant={variant}
        style={{ "--loading-indicator-speed": speedMap[speed] } as CSSProperties}
        aria-hidden="true"
      >
        {particleIndexes.map((index) => (
          <span
            key={index}
            className="loading-indicator-dot"
            style={{ "--particle-index": index } as CSSProperties}
          />
        ))}
        <span className="loading-indicator-ring" />
      </div>
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
