"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";

interface MobileFloatingNavProps {
  onMenuToggle?: () => void;
  mobileSidebarOpen?: boolean;
  learningNavigationVisible?: boolean;
}

/**
 * 移动端悬浮式导航：左侧悬浮菜单按钮 + 居中的「聊天 / 项目」胶囊。
 *  - 只渲染在移动端（lg:hidden）；桌面端由侧边栏承担模式切换，不需要胶囊
 *  - 不占据文档流高度，悬浮在内容上方，纵向空间全部留给正文
 *  - 项目内部页面（/projects/[id]）有自己的顶栏，由布局层决定不渲染本组件
 */
export function MobileFloatingNav({
  onMenuToggle,
  mobileSidebarOpen = false,
  learningNavigationVisible = false,
}: MobileFloatingNavProps) {
  const pathname = usePathname();
  const activeMode = pathname?.startsWith("/today")
    ? "today"
    : pathname?.startsWith("/projects")
      ? "projects"
      : pathname?.startsWith("/chat")
        ? "chat"
        : null;
  const modeClassName = cn(
    "inline-flex h-9 items-center justify-center rounded-full px-3 text-[13px] font-medium transition-[background-color,color,transform] duration-200 active:scale-[0.98] motion-reduce:transition-none",
    learningNavigationVisible ? "min-w-[4.25rem]" : "min-w-[5.5rem]"
  );

  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-40 flex items-center justify-center px-3 lg:hidden">
      <button
        type="button"
        onClick={onMenuToggle}
        className={cn(
          "pointer-events-auto absolute left-3 inline-flex h-10 w-10 items-center justify-center rounded-full",
          "bg-[var(--color-panel)] text-[var(--color-text-secondary)] shadow-[var(--shadow-pill)]",
          "transition-[background-color,color,transform] duration-150 hover:text-[var(--color-text-primary)] active:scale-[0.96] motion-reduce:transition-none"
        )}
        aria-label={mobileSidebarOpen ? "关闭导航" : "打开导航"}
        aria-expanded={mobileSidebarOpen}
      >
        <PanelLeftOpen size={17} strokeWidth={1.8} />
      </button>

      <nav
        aria-label="主要工作模式"
        className="pointer-events-auto flex items-center rounded-full bg-[var(--color-interaction-active)] p-0.5 shadow-[var(--shadow-pill)]"
      >
        {learningNavigationVisible && (
          <Link
            href="/today"
            aria-current={activeMode === "today" ? "page" : undefined}
            className={cn(
              modeClassName,
              activeMode === "today"
                ? "bg-[var(--color-panel)] text-[var(--color-text-primary)]"
                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            )}
          >
            今日
          </Link>
        )}
        <Link
          href="/chat"
          aria-current={activeMode === "chat" ? "page" : undefined}
          className={cn(
            modeClassName,
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
            modeClassName,
            activeMode === "projects"
              ? "bg-[var(--color-panel)] text-[var(--color-text-primary)]"
              : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          )}
        >
          项目
        </Link>
      </nav>
    </div>
  );
}
