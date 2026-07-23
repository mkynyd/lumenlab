"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollReveal } from "./scroll-reveal";

/**
 * 收束 CTA + 极简品牌尾。
 */
export function LandingFooter() {
  return (
    <footer className="relative border-t border-[var(--color-border-light)]">
      <div className="mx-auto w-full max-w-7xl px-4 py-20 sm:px-6 sm:py-28">
        <ScrollReveal className="flex flex-col items-start justify-between gap-10 sm:flex-row sm:items-end">
          <div>
            <p className="text-[13px] font-medium text-[var(--color-accent)]">
              从下一门课开始
            </p>
            <h2
              className="mt-4 max-w-[16ch] text-[clamp(2.25rem,5vw,4.8rem)] font-semibold leading-[1.02] tracking-[-0.045em] text-[var(--color-text-primary)]"
              style={{ textWrap: "balance" }}
            >
              把资料、问题和成果放在一起
            </h2>
            <p className="mt-5 max-w-[48ch] text-[15px] leading-7 text-[var(--color-text-secondary)]">
              当前为 Alpha 阶段，使用管理员签发的注册码即可开通。
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button
              asChild
              variant="ghost"
              size="lg"
              className="h-11 rounded-full px-4 text-[14px] font-medium"
            >
              <Link href="/login">已有账号</Link>
            </Button>
            <Button
              asChild
              size="lg"
              className="h-11 rounded-full px-5 text-[14px] font-medium"
            >
              <Link href="/register">
                开始使用
                <ArrowRight size={16} />
              </Link>
            </Button>
          </div>
        </ScrollReveal>

        <div className="mt-20 flex flex-col gap-2 border-t border-[var(--color-border-light)] pt-5 text-[12px] text-[var(--color-text-tertiary)] sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <span className="relative flex size-5 items-center justify-center overflow-hidden rounded-md">
              <Image
                src="/LumenLab-logo-only.png"
                alt="LumenLab"
                width={20}
                height={20}
                className="object-cover"
                aria-hidden
              />
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
