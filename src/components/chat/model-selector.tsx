"use client";

import { cn } from "@/lib/utils";

interface ModelSelectorProps {
  model: string;
  onChange: (model: string) => void;
  disabled?: boolean;
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
}: ModelSelectorProps) {
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label="Model">
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
              "px-2.5 py-1 text-xs rounded-[var(--radius-md)]",
              "border transition-colors duration-150",
              active
                ? "bg-[var(--color-accent)] text-white border-[var(--color-accent)]"
                : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
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
