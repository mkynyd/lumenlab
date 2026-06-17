"use client";

import { useEffect, useRef, useState } from "react";
import { NavArrowDown } from "iconoir-react";
import { cn } from "@/lib/utils";

export interface SelectMenuOption {
  value: string;
  label: string;
}

interface SelectMenuProps {
  value?: string;
  placeholder: string;
  options: SelectMenuOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  ariaLabel: string;
  labelAlign?: "left" | "center";
  className?: string;
}

export function SelectMenu({
  value,
  placeholder,
  options,
  onChange,
  disabled,
  ariaLabel,
  labelAlign = "left",
  className,
}: SelectMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  return (
    <div ref={ref} className={cn("relative min-w-0", className)}>
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "relative inline-flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-[var(--radius-md)] text-left",
          "border border-[var(--color-border-light)] bg-[var(--color-control)] px-3 text-xs font-medium",
          "text-[var(--color-text-primary)] transition-[background-color,border-color,color] duration-150",
          "hover:border-[var(--color-accent)] hover:bg-[var(--color-control)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-muted)]",
          "disabled:cursor-not-allowed disabled:opacity-40"
        )}
      >
        <span
          className={cn(
            "min-w-0 truncate",
            labelAlign === "center" ? "w-full px-4 text-center" : "flex-1 text-left"
          )}
        >
          {selected?.label || placeholder}
        </span>
        <NavArrowDown
          width={14}
          height={14}
          strokeWidth={1.9}
          className={cn(
            "shrink-0 text-[var(--color-text-tertiary)] transition-transform duration-150",
            labelAlign === "center" && "absolute right-3",
            open && "rotate-180"
          )}
        />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label={ariaLabel}
          className={cn(
            "absolute left-0 top-full z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-[var(--radius-md)]",
            "border border-[var(--color-border-light)] bg-[var(--color-control-menu)] p-1",
            "workbench-border-glow"
          )}
        >
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={cn(
                  "flex h-8 w-full items-center rounded-[var(--radius-md)] px-2.5 text-xs font-medium",
                  "transition-colors duration-150",
                  labelAlign === "center" ? "justify-center text-center" : "justify-start text-left",
                  active
                    ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                    : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
