"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatDemo } from "./demos/chat-demo";
import { ScrollReveal } from "./scroll-reveal";

/**
 * 居中的产品承诺 + 一块真实聊天界面预览。
 */
export function HeroSection() {
  return (
    <section className="relative overflow-hidden pb-24 pt-24 sm:pb-32 sm:pt-32">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
        <ScrollReveal className="mx-auto flex max-w-5xl flex-col items-center text-center" yOffset={16}>
          <p className="text-[13px] font-medium leading-snug text-[var(--color-accent)]">
            LumenLab · 大学生 AI 学习工作台
          </p>

          <h1
            className="mt-5 max-w-[15ch] text-[clamp(2.8rem,7.2vw,6.6rem)] font-semibold leading-[0.98] tracking-[-0.055em] text-[var(--color-text-primary)]"
            style={{ textWrap: "balance" }}
          >
            让每次提问，都变成学习成果
          </h1>

          <p
            className="mt-7 max-w-[54ch] text-[16px] leading-7 text-[var(--color-text-secondary)] sm:text-[18px] sm:leading-8"
            style={{ textWrap: "pretty" }}
          >
            把课程资料、上下文对话、PDF 解析和成果导出放进同一个项目。少切换工具，把精力留给理解、推导和表达。
          </p>

          <div className="mt-9 flex flex-wrap items-center justify-center gap-2">
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
            <Button
              asChild
              variant="ghost"
              size="lg"
              className="h-11 rounded-full px-4 text-[14px] font-medium"
            >
              <Link href="#features">查看工作流</Link>
            </Button>
          </div>
          <p className="mt-3 text-[12px] text-[var(--color-text-tertiary)]">
            Alpha 阶段免费 · 使用注册码开通
          </p>
        </ScrollReveal>

        <ScrollReveal
          className="relative mx-auto mt-16 h-[520px] w-full max-w-6xl overflow-hidden rounded-[28px] bg-[var(--color-surface)] ring-1 ring-[var(--color-border-light)] sm:mt-20 sm:h-[640px] sm:rounded-[32px]"
          yOffset={24}
        >
          <ChatDemo className="h-full w-full" />
        </ScrollReveal>
      </div>
    </section>
  );
}
