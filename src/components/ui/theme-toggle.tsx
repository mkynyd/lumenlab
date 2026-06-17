"use client";

import { useTheme } from "@/components/ui/theme-provider";
import { Sun, Moon, Monitor } from "lucide-react";
import { cn } from "@/lib/utils";

const options = [
  { key: "light" as const, Icon: Sun, label: "浅色" },
  { key: "system" as const, Icon: Monitor, label: "自动" },
  { key: "dark" as const, Icon: Moon, label: "深色" },
];

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();

  return (
    <div
      className={cn(
        "flex items-center border border-[var(--color-border-light)] rounded-[var(--radius-lg)] p-0.5",
        "bg-[var(--color-surface)] shadow-sm backdrop-blur-[var(--glass-blur)]",
        className
      )}
      role="radiogroup"
      aria-label="主题"
    >
      {options.map(({ key, Icon, label }) => {
        const active = theme === key;
        return (
          <button
            key={key}
            role="radio"
            aria-checked={active}
            aria-label={label}
            onClick={() => setTheme(key)}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] transition-colors duration-150",
              active
                ? "bg-[var(--color-accent)] text-[var(--color-accent-contrast)] shadow-sm"
                : "text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
            )}
          >
            <Icon size={14} strokeWidth={2} />
          </button>
        );
      })}
    </div>
  );
}
