import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/theme-toggle";

interface LandingNavProps {
  /** 是否显示左侧品牌 Logo；文档页等已将 Logo 放在侧边栏时可设为 false */
  showBrand?: boolean;
}

/**
 * 单层公开导航。无 sidebar、无 store 依赖、无认证态。
 */
export function LandingNav({ showBrand = true }: LandingNavProps) {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-[var(--color-border-light)] bg-[var(--color-bg)]">
      <nav
        aria-label="主导航"
        className="mx-auto flex h-[52px] w-full max-w-7xl items-center justify-between gap-3 px-4 sm:px-6"
      >
        {showBrand ? (
          <Link
            href="/home"
            className="flex items-center gap-2 rounded-lg px-1 py-1 text-[15px] font-semibold tracking-[-0.01em] text-[var(--color-text-primary)] transition-colors duration-200 hover:text-[var(--color-accent)]"
          >
            <span className="relative flex size-7 items-center justify-center overflow-hidden rounded-lg">
              <Image
                src="/LumenLab-logo-only.png"
                alt="LumenLab"
                width={28}
                height={28}
                className="object-cover"
                priority
              />
            </span>
            <span>LumenLab</span>
          </Link>
        ) : (
          <div aria-hidden />
        )}

        <div className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 md:flex">
          <Link
            href="#features"
            className="rounded-full px-3 py-1.5 text-[13px] text-[var(--color-text-secondary)] transition-colors duration-200 hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
          >
            工作流
          </Link>
          <Link
            href="#how-to"
            className="rounded-full px-3 py-1.5 text-[13px] text-[var(--color-text-secondary)] transition-colors duration-200 hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
          >
            上手
          </Link>
          <Link
            href="/docs"
            className="rounded-full px-3 py-1.5 text-[13px] text-[var(--color-text-secondary)] transition-colors duration-200 hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
          >
            文档
          </Link>
        </div>

        <div className="flex items-center gap-1">
          <div className="hidden sm:block">
            <ThemeToggle />
          </div>
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="h-8 rounded-full px-3 text-[13px]"
          >
            <Link href="/login">登录</Link>
          </Button>
          <Button
            asChild
            size="sm"
            className="h-8 rounded-full px-3.5 text-[13px]"
          >
            <Link href="/register">开始使用</Link>
          </Button>
        </div>
      </nav>
    </header>
  );
}
