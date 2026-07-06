"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { AmbientField } from "@/components/workbench/ambient-field";
import { Button } from "@/components/ui/button";
import { ChatDemo } from "./demos/chat-demo";
import { ScrollReveal } from "./scroll-reveal";

/**
 * 主页 hero：
 *  - 左列：强对比标题 + 副文 + 双 CTA
 *  - 右列：缩放版 chat-demo 预览
 *  - 背景：AmbientField 作为工作台签名（中等密度，不叠加发光）
 *
 * 视觉方向：克制但有力量。通过字号落差、留白节奏和单一 accent 重音建立层次，
 * 而不是渐变、玻璃或 metrics 模板。
 */
export function HeroSection() {
  return (
    <section className="relative isolate flex min-h-screen items-center overflow-hidden">
      <AmbientField
        intensity="medium"
        density="wide"
        className="-z-10 [mask-image:linear-gradient(to_bottom,black_0%,black_55%,transparent_100%)]"
      />

      <div className="mx-auto grid w-full max-w-7xl gap-12 px-4 pb-24 pt-14 sm:px-6 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:gap-14 md:pb-36 md:pt-24">
        <ScrollReveal className="flex flex-col justify-center" yOffset={20}>
          <p data-dot-avoid className="text-[15px] font-medium leading-snug text-[var(--color-accent)]">
            面向大学生的 AI 学习工作台
          </p>

          <h1
            data-dot-avoid
            className="mt-5 text-[clamp(2.25rem,6vw,4.5rem)] font-semibold leading-[1.08] tracking-[-0.03em] text-[var(--color-text-primary)] break-keep"
            style={{ textWrap: "pretty" }}
          >
            把讲义、AI 对话和 PDF 解析
            <br />
            <span className="text-[var(--color-accent)]">都装进一个项目</span>
          </h1>

          <p
            data-dot-avoid
            className="mt-6 max-w-[50ch] text-[16px] leading-[1.65] text-[var(--color-text-secondary)] sm:text-[17px]"
            style={{ textWrap: "pretty" }}
          >
            LumenLab 是为长期学习设计的工作台。整理资料、基于上下文提问、解析 PDF、导出成果，所有环节围绕项目闭环。
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
              <Link href="#features">了解功能</Link>
            </Button>
            <Button
              asChild
              variant="ghost"
              size="lg"
              className="h-12 rounded-[var(--radius-lg)] px-4 text-[15px] font-medium"
            >
              <Link href="/docs">阅读文档</Link>
            </Button>
          </div>
          <p data-dot-avoid className="mt-3 text-[13px] text-[var(--color-text-tertiary)]">
            Alpha 阶段免费 · 注册码现场签发
          </p>
        </ScrollReveal>

        <ScrollReveal
          className="relative flex items-center"
          yOffset={32}
          delay={0.1}
        >
          <ChatDemo className="w-full max-h-[680px] [&_div]:max-w-full" />
        </ScrollReveal>
      </div>
    </section>
  );
}
