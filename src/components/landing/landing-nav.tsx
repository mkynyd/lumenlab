import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/theme-toggle";

/**
 * 极简顶部导航。无 sidebar、无 store 依赖、无认证态。
 * 品牌 = Sparkles icon + LumenLab；右侧放主题切换和登录入口。
 */
export function LandingNav() {
  return (
    <header className="sticky top-0 z-40 w-full">
      <div
        className="absolute inset-0 -z-10 bg-[var(--color-bg)]/75 backdrop-blur-md"
        aria-hidden
      />
      <nav
        aria-label="主导航"
        className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between gap-3 px-4 sm:px-6"
      >
        <Link
          href="/"
          className="flex items-center gap-2 rounded-[var(--radius-md)] px-1 py-1 text-[14px] font-semibold tracking-tight text-[var(--color-text-primary)] transition-colors hover:text-[var(--color-accent)]"
        >
          <span className="flex size-7 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-accent)] text-[var(--color-accent-contrast)]">
            <Sparkles size={14} />
          </span>
          <span>LumenLab</span>
        </Link>

        <div className="flex items-center gap-1.5">
          <ThemeToggle />
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="h-8 rounded-[var(--radius-md)] px-3 text-[13px]"
          >
            <Link href="/login">登录</Link>
          </Button>
          <Button
            asChild
            size="sm"
            className="h-8 rounded-[var(--radius-md)] px-3 text-[13px]"
          >
            <Link href="/register">开始使用</Link>
          </Button>
        </div>
      </nav>
    </header>
  );
}
