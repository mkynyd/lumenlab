"use client";

import { cn } from "@/lib/utils";

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
  className?: string;
}

export function Switch({
  checked,
  onChange,
  disabled = false,
  label,
  className,
}: SwitchProps) {
  return (
    <label
      className={cn(
        "inline-flex items-center gap-2 cursor-pointer select-none",
        disabled && "opacity-50 cursor-not-allowed",
        className
      )}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full",
          "border transition-colors duration-150",
          checked
            ? "bg-[var(--color-accent)] border-[var(--color-accent)]"
            : "bg-[var(--color-ring-track)] border-[var(--color-border)]"
        )}
      >
        <span
          className={cn(
            "inline-block h-3.5 w-3.5 rounded-full bg-white",
            "transition-transform duration-150",
            checked ? "translate-x-[18px]" : "translate-x-[2px]"
          )}
        />
      </button>
      {label && (
        <span className="text-sm text-[var(--color-text-secondary)]">{label}</span>
      )}
    </label>
  );
}
