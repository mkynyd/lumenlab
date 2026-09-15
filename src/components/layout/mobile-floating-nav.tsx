"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftOpen } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
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
 *  - 选中态由共享 layoutId 的滑动 pill 表达，未命中具体模式时默认选中「聊天」
 */
export function MobileFloatingNav({
  onMenuToggle,
  mobileSidebarOpen = false,
  learningNavigationVisible = false,
}: MobileFloatingNavProps) {
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();
  // 未命中具体模式的路由默认选中「聊天」，保证胶囊始终有一个选中态
  const activeMode =
    pathname?.startsWith("/learning") || pathname?.startsWith("/today")
      ? "learning"
    : pathname?.startsWith("/projects")
      ? "projects"
      : "chat";
  const pillTransition = reduceMotion
    ? { duration: 0 }
    : { type: "spring" as const, stiffness: 520, damping: 42 };
  const modeClassName = cn(
    "relative inline-flex h-9 items-center justify-center rounded-full px-3 text-[13px] font-medium transition-[color,transform] duration-200 active:scale-[0.98] motion-reduce:transition-none",
    learningNavigationVisible ? "min-w-[4.25rem]" : "min-w-[5.5rem]"
  );

  function renderModeLink(
    mode: "learning" | "chat" | "projects",
    href: string,
    label: string
  ) {
    const isActive = activeMode === mode;
    return (
      <Link
        href={href}
        aria-current={isActive ? "page" : undefined}
        className={cn(
          modeClassName,
          isActive
            ? "text-[var(--color-text-primary)]"
            : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
        )}
      >
        {isActive && (
          <motion.span
            layoutId="mobile-mode-pill"
            transition={pillTransition}
            className="absolute inset-0 rounded-full bg-[var(--color-panel)]"
            aria-hidden
          />
        )}
        <span className="relative">{label}</span>
      </Link>
    );
  }

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

      <motion.nav
        aria-label="主要工作模式"
        initial={reduceMotion ? false : { opacity: 0, y: -6, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        className="pointer-events-auto flex items-center rounded-full bg-[var(--color-interaction-active)] p-0.5 shadow-[var(--shadow-pill)]"
      >
        {learningNavigationVisible &&
          renderModeLink("learning", "/learning", "学习")}
        {renderModeLink("chat", "/chat", "聊天")}
        {renderModeLink("projects", "/projects", "项目")}
      </motion.nav>
    </div>
  );
}
