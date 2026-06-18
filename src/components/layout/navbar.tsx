"use client";

import Link from "next/link";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { cn } from "@/lib/utils";
import {
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";

interface NavbarProps {
  onMenuToggle?: () => void;
  sidebarCollapsed?: boolean;
}

export function Navbar({ onMenuToggle, sidebarCollapsed = false }: NavbarProps) {
  return (
    <header
      className={cn(
        "h-14 shrink-0 flex items-center justify-between gap-2 px-3 sm:px-4",
        "border-b border-[var(--color-border-light)]",
        "bg-[var(--color-panel)] backdrop-blur-[var(--glass-blur)]"
      )}
    >
      {/* 左侧 */}
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <button
          onClick={onMenuToggle}
          className={cn(
            "inline-flex h-9 w-9 -ml-1 items-center justify-center rounded-[var(--radius-md)]",
            "bg-[var(--color-surface)]",
            "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]",
            "transition-colors duration-150"
          )}
          aria-label={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
          aria-expanded={!sidebarCollapsed}
        >
          {sidebarCollapsed ? (
            <PanelLeftOpen size={17} strokeWidth={1.8} />
          ) : (
            <PanelLeftClose size={17} strokeWidth={1.8} />
          )}
        </button>
        <Link
          href="/chat"
          className="truncate rounded-[var(--radius-sm)] px-1 text-sm font-semibold tracking-tight text-[var(--color-text-primary)] transition-colors hover:text-[var(--color-accent)]"
        >
          course-ai-lab
        </Link>
      </div>

      {/* 右侧 */}
      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        <ThemeToggle />
      </div>
    </header>
  );
}
