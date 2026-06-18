"use client";

import { cn } from "@/lib/utils";

interface ModelSelectorProps {
  model: string;
  onChange: (model: string) => void;
  disabled?: boolean;
  compact?: boolean;
  className?: string;
}

const models = [
  {
    id: "deepseek-v4-pro",
    label: "Pro",
    desc: "DeepSeek V4 Pro",
    price: "¥3/¥6",
  },
  {
    id: "deepseek-v4-flash",
    label: "Flash",
    desc: "DeepSeek V4 Flash",
    price: "¥1/¥2",
  },
];

export function ModelSelector({
  model,
  onChange,
  disabled = false,
  compact = false,
  className,
}: ModelSelectorProps) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-1 rounded-[var(--radius-lg)] bg-[var(--color-panel-muted)] p-0.5",
        className
      )}
      role="radiogroup"
      aria-label="Model"
    >
      {models.map((m) => {
        const active = model === m.id;
        return (
          <button
            key={m.id}
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(m.id)}
            className={cn(
              "rounded-[var(--radius-md)] text-xs",
              compact ? "px-2 py-1" : "px-2.5 py-1.5 sm:px-3",
              "border transition-[background-color,border-color,color,box-shadow] duration-150",
              active
                ? "bg-[var(--color-accent)] text-[var(--color-accent-contrast)] border-[var(--color-accent)]"
                : "border-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
            )}
            title={`${m.desc} · ${m.price} per 1M tokens`}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}
