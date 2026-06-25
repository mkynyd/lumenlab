"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Xmark } from "iconoir-react";
import { cn } from "@/lib/utils";
import { DOCS_NAV, type DocNavItem } from "@/lib/docs/docs-nav";

interface DocsSidebarProps {
  mobileOpen?: boolean;
  onClose?: () => void;
  className?: string;
}

function isItemActive(item: DocNavItem, pathname: string): boolean {
  const itemPath = item.slug ? `/docs/${item.slug}` : "/docs";
  return pathname === itemPath;
}

export function DocsSidebar({
  mobileOpen = false,
  onClose,
  className,
}: DocsSidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-30 h-screen w-64 overflow-y-auto border-r border-[var(--color-border-light)] bg-[var(--color-panel)]",
        "transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
        mobileOpen ? "translate-x-0" : "-translate-x-full",
        "lg:translate-x-0",
        className
      )}
      aria-label="文档导航"
    >
      <div className="flex items-center justify-between px-4 py-3">
        <Link
          href="/home"
          className="flex items-center gap-2 rounded-[var(--radius-md)] px-1 py-1 text-[15px] font-semibold tracking-tight text-[var(--color-text-primary)] transition-colors hover:text-[var(--color-accent)]"
        >
          <span className="relative flex size-8 items-center justify-center overflow-hidden rounded-[var(--radius-md)]">
            <Image
              src="/LumenLab-logo-only.png"
              alt="LumenLab"
              width={32}
              height={32}
              className="object-cover"
              priority
            />
          </span>
          <span>LumenLab</span>
        </Link>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] lg:hidden"
          aria-label="关闭文档导航"
        >
          <Xmark width={16} height={16} strokeWidth={2} />
        </button>
      </div>

      <nav className="px-3 pb-8" aria-label="文档目录">
        {DOCS_NAV.map((section) => (
          <div key={section.title} className="mb-5">
            <h3 className="px-3 py-1.5 text-[12px] font-medium text-[var(--color-text-tertiary)]">
              {section.title}
            </h3>
            <ul className="flex flex-col gap-0.5">
              {section.items.map((item) => {
                const href = item.slug ? `/docs/${item.slug}` : "/docs";
                const active = isItemActive(item, pathname);
                return (
                  <li key={item.slug}>
                    <Link
                      href={href}
                      onClick={onClose}
                      className={cn(
                        "block rounded-[var(--radius-md)] px-3 py-1.5 text-[13px] leading-snug transition-colors",
                        active
                          ? "bg-[var(--color-surface-active)] font-medium text-[var(--color-text-primary)]"
                          : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
                      )}
                      aria-current={active ? "page" : undefined}
                    >
                      {item.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
