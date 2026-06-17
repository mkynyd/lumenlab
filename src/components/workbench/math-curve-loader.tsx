"use client";

import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

type CurveVariant = "lissajous" | "rose" | "orbit";

interface MathCurveLoaderProps {
  label?: string;
  detail?: string;
  variant?: CurveVariant;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const particleIndexes = [0, 1, 2, 3, 4, 5];

export function MathCurveLoader({
  label = "正在计算",
  detail,
  variant = "lissajous",
  size = "md",
  className,
}: MathCurveLoaderProps) {
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
