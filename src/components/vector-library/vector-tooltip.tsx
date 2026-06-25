"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export interface VectorTooltipState {
  visible: boolean;
  x: number;
  y: number;
  title: string;
  lines: string[];
}

const noOpSubscribe = () => () => {};

export function VectorTooltip({ state }: { state: VectorTooltipState }) {
  const mounted = useSyncExternalStore(
    noOpSubscribe,
    () => true,
    () => false
  );

  if (!mounted || !state.visible) return null;

  return createPortal(
    <div
      role="tooltip"
      className={cn(
        "fixed z-[100] max-w-xs rounded-[var(--radius-sm)]",
        "bg-[var(--color-control-menu)] px-3 py-2 shadow-[var(--shadow-float)]",
        "pointer-events-none select-none text-left"
      )}
      style={{
        left: state.x + 12,
        top: state.y + 12,
      }}
    >
      <div className="text-xs font-medium text-[var(--color-text-primary)]">
        {state.title}
      </div>
      {state.lines.map((line, i) => (
        <div
          key={i}
          className="mt-1 text-[11px] leading-snug text-[var(--color-text-secondary)]"
        >
          {line}
        </div>
      ))}
    </div>,
    document.body
  );
}
