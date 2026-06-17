"use client";

import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

type CurveVariant = "lissajous" | "rose" | "orbit";

interface MathCurveLoaderProps {
  label?: string;
  detail?: string;
  variant?: CurveVariant;
  size?: "sm" | "md" | "lg";
  speed?: "calm" | "normal" | "fast";
  className?: string;
}

const particleIndexes = [0, 1, 2, 3, 4, 5];

export function MathCurveLoader({
  label = "正在计算",
  detail,
  variant = "lissajous",
  size = "md",
  speed = "calm",
  className,
}: MathCurveLoaderProps) {
  const speedMap = {
    calm: "3.25s",
    normal: "2.65s",
    fast: "2.1s",
  };

  return (
    <div
      className={cn("math-curve-status", className)}
      role="status"
      aria-live="polite"
      aria-label={detail ? `${label}，${detail}` : label}
    >
      <div
        className={cn("math-curve-loader", `math-curve-${size}`)}
        data-curve={variant}
        style={{ "--math-curve-speed": speedMap[speed] } as CSSProperties}
        aria-hidden="true"
      >
        {particleIndexes.map((index) => (
          <span
            key={index}
            className="math-curve-particle"
            style={{ "--particle-index": index } as CSSProperties}
          />
        ))}
        <span className="math-curve-axis" />
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
