"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RotatingText } from "@/components/ui/rotating-text";
import { ScrollReveal } from "./scroll-reveal";
import { cn } from "@/lib/utils";

/**
 * 落地 CTA + 极简品牌尾。
 * - 主 CTA：开始使用 / 已有账号
 * - 右侧 RotatingText：短动作词，整行紧凑不拼接长句
 */
const FOOTER_TEXTS = [
  "第一个聊天",
  "创建项目",
  "转换 PDF",
  "分析考点",
  "构建知识架构",
];

const ROTATING_SIZE = "text-[24px] sm:text-[28px]";

export function LandingFooter() {
  return (
    <footer
      className="relative flex min-h-screen items-center bg-[var(--color-bg)]"
    >
      <div className="mx-auto w-full max-w-7xl px-4 py-24 sm:px-6 sm:py-36">
        <ScrollReveal>
          <div className="grid items-end gap-12 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div>
              <p className="text-[15px] font-medium text-[var(--color-accent)]">
                起步
              </p>
              <h2
                className="mt-4 max-w-[14ch] text-[clamp(1.875rem,4vw,2.75rem)] font-semibold leading-[1.1] tracking-[-0.025em] text-[var(--color-text-primary)]"
                style={{ textWrap: "balance" }}
              >
                注册即建项目
                <br />
                AI 沉淀成果
              </h2>
              <p className="mt-5 max-w-[48ch] text-[16px] leading-[1.65] text-[var(--color-text-secondary)]">
                当前为 Alpha 阶段，账号通过注册码开通。注册后即可进入「项目空间」开始。
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Button
                  asChild
                  size="lg"
                  className="h-12 rounded-[var(--radius-lg)] px-6 text-[15px] font-medium"
                >
                  <Link href="/register">
                    开始使用
                    <ArrowRight size={16} />
                  </Link>
                </Button>
                <Button
                  asChild
                  variant="ghost"
                  size="lg"
                  className="h-12 rounded-[var(--radius-lg)] px-4 text-[15px] font-medium"
                >
                  <Link href="/login">已有账号</Link>
                </Button>
              </div>
              <p className="mt-3 text-[13px] text-[var(--color-text-tertiary)]">
                Alpha 阶段完全免费，注册码由管理员签发
              </p>
            </div>

            <div className="flex flex-col items-start gap-3 sm:items-end">
              <p className="text-[13px] font-medium text-[var(--color-text-tertiary)]">
                下一步
              </p>
              <div className="flex flex-col items-start gap-1 sm:items-end">
                <span
                  className={cn(
                    "font-medium tracking-tight text-[var(--color-text-primary)]",
                    ROTATING_SIZE
                  )}
                >
                  从这里开始
                </span>
                <RotatingText
                  texts={FOOTER_TEXTS}
                  interval={2400}
                  staggerDuration={0.028}
                  mainClassName={cn(
                    "items-baseline gap-2 font-medium tracking-tight",
                    ROTATING_SIZE
                  )}
                  rotatingWrapperClassName={cn(
                    "rounded-md px-2.5 py-1 text-[var(--color-accent-contrast)]",
                    "bg-[var(--color-accent)]"
                  )}
                />
              </div>
            </div>
          </div>
        </ScrollReveal>

        <div className="mt-20 flex flex-col gap-2 border-t border-[var(--color-border-light)] pt-6 text-[13px] text-[var(--color-text-tertiary)] sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <span className="relative flex size-6 items-center justify-center overflow-hidden rounded-[var(--radius-xs)]">
              <Image
                src="/LumenLab-logo-only.png"
                alt="LumenLab"
                width={24}
                height={24}
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
