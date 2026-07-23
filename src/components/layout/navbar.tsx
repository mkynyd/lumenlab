"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { cn } from "@/lib/utils";
import {
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";

interface NavbarProps {
  onMenuToggle?: () => void;
  sidebarCollapsed?: boolean;
  mobileSidebarOpen?: boolean;
  desktopSidebarLocked?: boolean;
}

export function Navbar({
  onMenuToggle,
  sidebarCollapsed = false,
  mobileSidebarOpen = false,
  desktopSidebarLocked = false,
}: NavbarProps) {
  const pathname = usePathname();
  const activeMode = pathname?.startsWith("/projects")
    ? "projects"
    : pathname?.startsWith("/chat")
      ? "chat"
      : null;

  return (
    <header
      className={cn(
        "relative z-20 flex h-[52px] shrink-0 items-center justify-between gap-2 px-3 sm:px-4",
        "border-b border-[var(--color-border-light)]",
        "bg-[var(--color-panel)]"
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <button
          onClick={onMenuToggle}
          className={cn(
            "-ml-1 inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-md)] lg:hidden",
            "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]",
            "transition-[background-color,color,transform] duration-150 active:scale-[0.97]"
          )}
          aria-label={mobileSidebarOpen ? "关闭导航" : "打开导航"}
          aria-expanded={mobileSidebarOpen}
        >
          {mobileSidebarOpen ? (
            <PanelLeftClose size={17} strokeWidth={1.8} />
          ) : (
            <PanelLeftOpen size={17} strokeWidth={1.8} />
          )}
        </button>
        {sidebarCollapsed && !desktopSidebarLocked && (
          <button
            onClick={onMenuToggle}
            className={cn(
              "-ml-1 hidden h-8 w-8 items-center justify-center rounded-[var(--radius-md)] lg:inline-flex",
              "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]",
              "transition-[background-color,color,transform] duration-150 active:scale-[0.97]"
            )}
            aria-label="展开侧边栏"
            aria-expanded={false}
          >
            <PanelLeftOpen size={17} strokeWidth={1.8} />
          </button>
        )}
        <Link
          href="/chat"
          className={cn(
            "inline-flex min-h-11 items-center truncate rounded-[var(--radius-sm)] px-1 text-sm font-semibold tracking-[-0.02em] text-[var(--color-text-primary)] transition-colors hover:text-[var(--color-accent)] lg:hidden",
            sidebarCollapsed && !desktopSidebarLocked && "lg:inline-flex"
          )}
        >
          LumenLab
        </Link>
      </div>

      <nav
        aria-label="主要工作模式"
        className="absolute left-1/2 hidden -translate-x-1/2 items-center rounded-full bg-[var(--color-interaction-active)] p-0.5 shadow-[var(--shadow-pill)] sm:flex"
      >
        <Link
          href="/chat"
          aria-current={activeMode === "chat" ? "page" : undefined}
          className={cn(
            "inline-flex h-8 min-w-[6.25rem] items-center justify-center rounded-full px-4 text-xs font-medium transition-[background-color,color,transform] duration-200 active:scale-[0.98] motion-reduce:transition-none",
            activeMode === "chat"
              ? "bg-[var(--color-panel)] text-[var(--color-text-primary)]"
              : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          )}
        >
          聊天
        </Link>
        <Link
          href="/projects"
          aria-current={activeMode === "projects" ? "page" : undefined}
          className={cn(
            "inline-flex h-8 min-w-[6.25rem] items-center justify-center rounded-full px-4 text-xs font-medium transition-[background-color,color,transform] duration-200 active:scale-[0.98] motion-reduce:transition-none",
            activeMode === "projects"
              ? "bg-[var(--color-panel)] text-[var(--color-text-primary)]"
              : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          )}
        >
          项目
        </Link>
      </nav>

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        <ThemeToggle />
      </div>
    </header>
  );
}
