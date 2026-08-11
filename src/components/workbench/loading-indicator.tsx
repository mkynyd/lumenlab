"use client";

import { ThinkingOrb, type OrbState } from "thinking-orbs";

import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";

type LoadingVariant = "lissajous" | "rose" | "orbit";

interface LoadingIndicatorProps {
  label?: string;
  detail?: string;
  variant?: LoadingVariant;
  /** 传入后改用 thinking-orbs 点阵动画（AI 等待场景），替换默认 Spinner */
  orb?: OrbState;
  size?: "sm" | "md" | "lg";
  speed?: "calm" | "normal" | "fast";
  className?: string;
}

const ORB_SPEED: Record<NonNullable<LoadingIndicatorProps["speed"]>, number> = {
  calm: 0.8,
  normal: 1,
  fast: 1.3,
};

export function LoadingIndicator({
  label = "正在计算",
  detail,
  variant = "lissajous",
  orb,
  size = "md",
  speed = "calm",
  className,
}: LoadingIndicatorProps) {
  void variant;

  return (
    <div
      className={cn(
        "loading-indicator-status",
        orb && size === "lg" && "flex-col",
        className
      )}
      role="status"
      aria-live="polite"
      aria-label={detail ? `${label}，${detail}` : label}
    >
      {orb ? (
        <ThinkingOrb
          state={orb}
          size={size === "lg" ? 64 : 20}
          theme="auto"
          speed={ORB_SPEED[speed]}
          aria-hidden="true"
        />
      ) : (
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
      )}
      <span className={cn("min-w-0", orb && size === "lg" && "text-center")}>
        <span className="block truncate text-xs font-medium text-[var(--color-text-primary)]">
          {label}
        </span>
        {detail && (
          <span className="block truncate text-xs text-[var(--color-text-tertiary)]">
            {detail}
          </span>
        )}
      </span>
    </div>
  );
}
