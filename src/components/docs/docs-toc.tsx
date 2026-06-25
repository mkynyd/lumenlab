"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import type { DocHeading } from "@/lib/docs/docs-nav";

interface DocsTocProps {
  headings: DocHeading[];
  className?: string;
}

export function DocsToc({ headings, className }: DocsTocProps) {
  const [activeId, setActiveId] = useState<string | null>(
    headings.length > 0 ? headings[0].id : null
  );

  useEffect(() => {
    if (headings.length === 0) return;

    const main = document.querySelector("main");
    if (!main) return;

    function updateActiveFromScroll() {
      const scrollContainer = main;
      if (!scrollContainer) return;

      const containerRect = scrollContainer.getBoundingClientRect();
      const threshold = containerRect.top + containerRect.height * 0.15;

      let current: string | null = null;
      for (const heading of headings) {
        const element = document.getElementById(heading.id);
        if (!element) continue;
        const rect = element.getBoundingClientRect();
        if (rect.top <= threshold) {
          current = heading.id;
        } else {
          break;
        }
      }

      if (current === null) {
        current = headings[0]?.id ?? null;
      }

      const nearBottom =
        scrollContainer.scrollTop + scrollContainer.clientHeight >=
        scrollContainer.scrollHeight - 24;
      if (nearBottom) {
        current = headings[headings.length - 1]?.id ?? current;
      }

      setActiveId(current);
    }

    updateActiveFromScroll();
    const scrollContainer = main;
    scrollContainer.addEventListener("scroll", updateActiveFromScroll, { passive: true });
    return () => scrollContainer.removeEventListener("scroll", updateActiveFromScroll);
  }, [headings]);

  if (headings.length === 0) return null;

  return (
    <aside
      className={cn("hidden xl:block xl:w-56 xl:shrink-0", className)}
      aria-label="当前页面目录"
    >
      <div className="sticky top-3 max-h-[calc(100vh-6rem)] overflow-y-auto px-4">
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <ThemeToggle className="shrink-0" />
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="h-10 rounded-[var(--radius-md)] px-3 text-[13px]"
          >
            <Link href="/docs">文档</Link>
          </Button>
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="h-10 rounded-[var(--radius-md)] px-3 text-[13px]"
          >
            <Link href="/login">登录</Link>
          </Button>
          <Button
            asChild
            size="sm"
            className="h-10 rounded-[var(--radius-md)] px-3 text-[13px]"
          >
            <Link href="/register">开始使用</Link>
          </Button>
        </div>
        <h4 className="mb-3 text-[13px] font-medium text-[var(--color-text-primary)]">
          本页内容
        </h4>
        <ul className="flex flex-col gap-1">
          {headings.map((heading) => (
            <li
              key={heading.id}
              className={cn("leading-snug", heading.level === 3 && "pl-3")}
            >
              <a
                href={`#${heading.id}`}
                className={cn(
                  "block rounded-[var(--radius-sm)] py-1 pl-2 pr-2 text-[13px] transition-colors",
                  activeId === heading.id
                    ? "bg-[var(--color-accent-muted)] font-medium text-[var(--color-accent)]"
                    : "text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
                )}
                onClick={(event) => {
                  event.preventDefault();
                  const element = document.getElementById(heading.id);
                  if (element) {
                    element.scrollIntoView({ behavior: "smooth", block: "start" });
                    window.history.pushState(null, "", `#${heading.id}`);
                  }
                }}
              >
                {heading.text}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
