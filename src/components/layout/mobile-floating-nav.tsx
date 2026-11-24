"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef, useState } from "react";
import { PanelLeftOpen } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

interface MobileFloatingNavProps {
  onMenuToggle?: () => void;
  mobileSidebarOpen?: boolean;
  learningNavigationVisible?: boolean;
}

interface ModePillBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// 指示胶囊用短行程弹簧跟随选中项。
const MODE_PILL_SPRING = { type: "spring" as const, stiffness: 460, damping: 30, mass: 0.72 };

/**
 * 移动端悬浮式导航：左侧悬浮菜单按钮 + 居中的「聊天 / 项目」胶囊。
 *  - 只渲染在移动端（lg:hidden）；桌面端由侧边栏承担模式切换，不需要胶囊
 *  - 不占据文档流高度，悬浮在内容上方，纵向空间全部留给正文
 *  - 项目内部页面（/projects/[id]）有自己的顶栏，由布局层决定不渲染本组件
 *  - 选中态是与 HeroUI Tabs.Indicator 同构的单个滑动 pill（测量目标位置后
 *    弹簧移动，跨项跳转也是一段连续位移），未命中具体模式时默认选中「聊天」
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
    : pathname?.startsWith("/files")
      ? "files"
      : "chat";
  const navRef = useRef<HTMLElement>(null);
  const [modePill, setModePill] = useState<ModePillBox | null>(null);
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const measure = () => {
      const active = nav.querySelector<HTMLElement>('a[aria-current="page"]');
      setModePill(
        active
          ? {
              x: active.offsetLeft,
              y: active.offsetTop,
              width: active.offsetWidth,
              height: active.offsetHeight,
            }
          : null
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [activeMode, learningNavigationVisible]);
  const modeClassName =
    "relative inline-flex h-10 min-w-0 flex-1 items-center justify-center whitespace-nowrap rounded-full px-1.5 text-[13px] font-medium leading-none transition-[color,transform] duration-200 active:scale-[0.97] focus-visible:bg-[var(--color-interaction-hover)] focus-visible:outline-none motion-reduce:transition-none min-[400px]:min-w-14 min-[400px]:px-3";

  function renderModeLink(
    mode: "learning" | "chat" | "projects" | "files",
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
        {label}
      </Link>
    );
  }

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      className="pointer-events-none fixed inset-x-0 top-3 z-40 grid grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center gap-1 px-3 lg:hidden"
    >
      <button
        type="button"
        onClick={onMenuToggle}
        className={cn(
          "pointer-events-auto inline-flex size-11 items-center justify-center rounded-full",
          "bg-[var(--color-panel)] text-[var(--color-text-secondary)] shadow-[var(--shadow-pill)]",
          "transition-[background-color,color,transform] duration-200 ease-[cubic-bezier(0.26,1.24,0.42,1)] hover:text-[var(--color-text-primary)] active:scale-[0.96] focus-visible:bg-[var(--color-interaction-hover)] focus-visible:outline-none motion-reduce:transition-none"
        )}
        aria-label={mobileSidebarOpen ? "关闭导航" : "打开导航"}
        aria-expanded={mobileSidebarOpen}
      >
        <PanelLeftOpen size={17} strokeWidth={1.8} />
      </button>

      <nav
        ref={navRef}
        aria-label="主要工作模式"
        className="pointer-events-auto relative flex w-full max-w-72 items-center justify-self-center rounded-full bg-[var(--color-interaction-active)] p-0.5 shadow-[var(--shadow-pill)]"
      >
        {modePill && (
          <motion.span
            initial={false}
            animate={{
              x: modePill.x,
              y: modePill.y,
              width: modePill.width,
              height: modePill.height,
            }}
            transition={reduceMotion ? { duration: 0 } : MODE_PILL_SPRING}
            className="pointer-events-none absolute left-0 top-0 rounded-full bg-[var(--color-panel)]"
            aria-hidden
          />
        )}
        {learningNavigationVisible &&
          renderModeLink("learning", "/learning", "学习")}
        {renderModeLink("chat", "/chat", "聊天")}
        {renderModeLink("projects", "/projects", "项目")}
        {renderModeLink("files", "/files", "资料")}
      </nav>
    </motion.div>
  );
}
