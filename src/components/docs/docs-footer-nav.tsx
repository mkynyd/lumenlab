"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DocNavItem } from "@/lib/docs/docs-nav";

interface DocsFooterNavProps {
  prev: DocNavItem | null;
  next: DocNavItem | null;
}

export function DocsFooterNav({ prev, next }: DocsFooterNavProps) {
  return (
    <nav
      className="mt-16 border-t border-[var(--color-border-light)] pt-8"
      aria-label="文档分页"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className={cn("flex", !prev && "sm:col-start-2 sm:justify-end")}>
          {prev && (
            <Link
              href={prev.slug ? `/docs/${prev.slug}` : "/docs"}
              className="group flex w-full flex-col gap-1 rounded-[var(--radius-lg)] bg-[var(--color-surface)] p-4 transition-colors hover:bg-[var(--color-surface-hover)] sm:w-auto"
            >
              <span className="flex items-center gap-1 text-[12px] text-[var(--color-text-tertiary)]">
                <ArrowLeft size={14} strokeWidth={2} />
                上一篇
              </span>
              <span className="text-[14px] font-medium text-[var(--color-text-primary)] group-hover:text-[var(--color-accent)]">
                {prev.title}
              </span>
            </Link>
          )}
        </div>
        <div className={cn("flex", next && "sm:justify-end")}>
          {next && (
            <Link
              href={next.slug ? `/docs/${next.slug}` : "/docs"}
              className="group flex w-full flex-col gap-1 rounded-[var(--radius-lg)] bg-[var(--color-surface)] p-4 text-right transition-colors hover:bg-[var(--color-surface-hover)] sm:w-auto"
            >
              <span className="flex items-center justify-end gap-1 text-[12px] text-[var(--color-text-tertiary)]">
                下一篇
                <ArrowRight size={14} strokeWidth={2} />
              </span>
              <span className="text-[14px] font-medium text-[var(--color-text-primary)] group-hover:text-[var(--color-accent)]">
                {next.title}
              </span>
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
