import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollReveal } from "./scroll-reveal";

/**
 * 落地 CTA + 极简链接列。结尾页是单独成段的 CTA 块。
 */
export function LandingFooter() {
  return (
    <footer className="relative bg-[var(--color-bg)]">
      <div className="mx-auto w-full max-w-7xl px-4 py-20 sm:px-6 sm:py-28">
        <ScrollReveal>
          <div className="grid items-end gap-8 sm:grid-cols-[1.5fr_1fr]">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-tertiary)]">
                准备好开始
              </p>
              <h2
                className="mt-3 text-[clamp(1.875rem,3.6vw,2.75rem)] font-semibold leading-[1.12] tracking-[-0.025em] text-[var(--color-text-primary)]"
                style={{ textWrap: "balance" }}
              >
                把下一个学习项目
                <br />
                放进同一张工作台。
              </h2>
              <p className="mt-4 max-w-[48ch] text-[15px] leading-relaxed text-[var(--color-text-secondary)]">
                注册一个账号即可创建项目、挂载资料、和 AI 一起把成果沉淀下来。
              </p>
              <div className="mt-7 flex flex-wrap items-center gap-3">
                <Button
                  asChild
                  size="lg"
                  className="h-11 rounded-[var(--radius-lg)] px-5 text-[14px] font-medium"
                >
                  <Link href="/register">
                    开始使用
                    <ArrowRight size={15} />
                  </Link>
                </Button>
                <Button
                  asChild
                  variant="ghost"
                  size="lg"
                  className="h-11 rounded-[var(--radius-lg)] px-4 text-[14px] font-medium"
                >
                  <Link href="/login">已有账号</Link>
                </Button>
              </div>
            </div>

            <nav
              aria-label="次级导航"
              className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] sm:justify-self-end"
            >
              <FooterLink href="/login">登录</FooterLink>
              <FooterLink href="/register">注册</FooterLink>
              <FooterLink href="#features">功能</FooterLink>
              <FooterLink href="#how-to">上手</FooterLink>
            </nav>
          </div>
        </ScrollReveal>

        <div className="mt-16 flex flex-col gap-2 border-t border-[var(--color-border-light)] pt-6 text-[12px] text-[var(--color-text-tertiary)] sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <span className="flex size-5 items-center justify-center rounded-[var(--radius-xs)] bg-[var(--color-accent)] text-[var(--color-accent-contrast)]">
              <Sparkles size={10} />
            </span>
            <span>LumenLab</span>
            <span aria-hidden>·</span>
            <span>学习工作台</span>
          </div>
          <span>© 2026 LumenLab</span>
        </div>
      </div>
    </footer>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-[var(--radius-sm)] px-1 py-0.5 text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-accent)]"
    >
      {children}
    </Link>
  );
}
