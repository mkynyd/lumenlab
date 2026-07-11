import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/theme-toggle";

interface LandingNavProps {
  /** 是否显示左侧品牌 Logo；文档页等已将 Logo 放在侧边栏时可设为 false */
  showBrand?: boolean;
}

/**
 * 极简顶部导航。无 sidebar、无 store 依赖、无认证态。
 * 品牌 = Sparkles icon + LumenLab；右侧放主题切换和登录入口。
 */
export function LandingNav({ showBrand = true }: LandingNavProps) {
  return (
    <header className="sticky top-0 z-40 w-full">
      <div
        className="absolute inset-0 -z-10 bg-[var(--color-bg)]/80"
        aria-hidden
      />
      <nav
        aria-label="主导航"
        className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between gap-3 px-4 sm:px-6"
      >
        {showBrand ? (
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
        ) : (
          <div aria-hidden />
        )}

        <div className="flex items-center gap-2">
          <div className="hidden sm:block">
            <ThemeToggle />
          </div>
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="hidden h-9 rounded-[var(--radius-md)] px-3 text-[14px] sm:inline-flex"
          >
            <Link href="/docs">文档</Link>
          </Button>
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="h-9 rounded-[var(--radius-md)] px-3 text-[14px]"
          >
            <Link href="/login">登录</Link>
          </Button>
          <Button
            asChild
            size="sm"
            className="h-9 rounded-[var(--radius-md)] px-3 text-[14px]"
          >
            <Link href="/register">开始使用</Link>
          </Button>
        </div>
      </nav>
    </header>
  );
}
