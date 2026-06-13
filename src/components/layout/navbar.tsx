"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useState, useRef, useEffect } from "react";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Menu,
  Settings,
  LogOut,
  ChevronDown,
} from "lucide-react";

interface NavbarProps {
  onMenuToggle?: () => void;
}

export function Navbar({ onMenuToggle }: NavbarProps) {
  const { data: session } = useSession();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭下拉菜单
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (!session?.user) return null;

  return (
    <header
      className={cn(
        "h-12 shrink-0 flex items-center justify-between px-4",
        "border-b border-[var(--color-border)]",
        "bg-[var(--color-surface)]"
      )}
    >
      {/* 左侧 */}
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuToggle}
          className="lg:hidden p-1 -ml-1 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
          aria-label="切换侧边栏"
        >
          <Menu size={18} strokeWidth={2} />
        </button>
        <Link
          href="/chat"
          className="text-sm font-semibold tracking-tight text-[var(--color-text-primary)] hover:text-[var(--color-accent)] transition-colors"
        >
          Light AI Chat
        </Link>
        <nav className="hidden sm:flex items-center gap-1 ml-2">
          <Link
            href="/chat"
            className={cn(
              "px-2 py-1 text-xs rounded-[var(--radius-md)] transition-colors",
              pathname.startsWith("/chat") && !pathname.startsWith("/projects")
                ? "bg-[var(--color-accent-muted)] text-[var(--color-accent)]"
                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            )}
          >
            聊天
          </Link>
          <Link
            href="/projects"
            className={cn(
              "px-2 py-1 text-xs rounded-[var(--radius-md)] transition-colors",
              pathname.startsWith("/projects")
                ? "bg-[var(--color-accent-muted)] text-[var(--color-accent)]"
                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            )}
          >
            项目
          </Link>
        </nav>
      </div>

      {/* 右侧 */}
      <div className="flex items-center gap-2">
        <ThemeToggle />

        {/* 用户菜单 */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className={cn(
              "flex items-center gap-1.5 h-8 px-2 rounded-[var(--radius-md)]",
              "text-sm text-[var(--color-text-secondary)]",
              "hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]",
              "transition-colors duration-150"
            )}
          >
            <span className="max-w-[120px] truncate">
              {session.user.name || session.user.email}
            </span>
            <ChevronDown
              size={14}
              strokeWidth={2}
              className={cn(
                "transition-transform duration-150",
                menuOpen && "rotate-180"
              )}
            />
          </button>

          {menuOpen && (
            <div
              className={cn(
                "absolute right-0 top-full mt-1 w-48 py-1 z-50",
                "border border-[var(--color-border)] rounded-[var(--radius-md)]",
                "bg-[var(--color-surface)]"
              )}
            >
              <Link
                href="/settings"
                onClick={() => setMenuOpen(false)}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 text-sm",
                  "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]",
                  "transition-colors duration-150"
                )}
              >
                <Settings size={14} strokeWidth={2} />
                设置
              </Link>
              <button
                onClick={() => signOut({ callbackUrl: "/login" })}
                className={cn(
                  "flex items-center gap-2 w-full px-3 py-2 text-sm",
                  "text-[var(--color-error)] hover:bg-[var(--color-error-muted)]",
                  "transition-colors duration-150"
                )}
              >
                <LogOut size={14} strokeWidth={2} />
                退出登录
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
