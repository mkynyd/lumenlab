"use client";

import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { AmbientField } from "@/components/workbench/ambient-field";
import { Button } from "@/components/ui/button";
import { ChatDemo } from "./demos/chat-demo";
import { ScrollReveal } from "./scroll-reveal";

/**
 * 主页 hero：
 *  - 左列：粗体短句（中文 2-3 行，text-wrap balance）+ 副文 + 双 CTA
 *  - 右列：缩放版 chat-demo 预览
 *  - 背景：AmbientField（mask 渐变，不喧宾夺主）
 */
export function HeroSection() {
  return (
    <section className="relative isolate overflow-hidden">
      <AmbientField
        intensity="low"
        density="wide"
        className="-z-10 [mask-image:linear-gradient(to_bottom,black_0%,black_60%,transparent_100%)]"
      />

      <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 pb-20 pt-12 sm:px-6 md:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] md:gap-12 md:pb-28 md:pt-20">
        <ScrollReveal className="flex flex-col justify-center" yOffset={20}>
          <span className="inline-flex w-fit items-center gap-1.5 rounded-4xl bg-[var(--color-surface)] px-3 py-1 text-[12px] font-medium text-[var(--color-text-secondary)] shadow-[var(--shadow-none)]">
            <Sparkles size={12} className="text-[var(--color-accent)]" />
            面向大学生的 AI 学习工作台
          </span>

          <h1
            className="mt-5 text-[clamp(2.25rem,4.5vw,4.25rem)] font-semibold leading-[1.08] tracking-[-0.03em] text-[var(--color-text-primary)]"
            style={{ textWrap: "balance" }}
          >
            把 AI 对话、实验资料
            <br className="hidden sm:block" />
            和文档解析
            <span className="text-[var(--color-accent)]">放回同一张工作台</span>
            。
          </h1>

          <p
            className="mt-5 max-w-[58ch] text-[15px] leading-relaxed text-[var(--color-text-secondary)] sm:text-[16px]"
            style={{ textWrap: "pretty" }}
          >
            LumenLab 把「提问、资料、文档、成果」四件事收进同一个项目上下文。
            不必在多个标签页和聊天窗口之间反复搬运，所有引用都对得上来源。
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
              <Link href="#features">了解更多</Link>
            </Button>
          </div>

          <dl className="mt-10 grid grid-cols-3 gap-4 text-left">
            <HeroStat label="项目上下文" value="自动" detail="按资料召回" />
            <HeroStat label="文档转换" value="PDF→MD" detail="含图片与公式" />
            <HeroStat label="学习成果" value="一键导出" detail="MD / PDF / DOCX" />
          </dl>
        </ScrollReveal>

        <ScrollReveal
          className="relative flex items-center"
          yOffset={32}
          delay={0.1}
        >
          <div className="absolute -inset-3 -z-10 rounded-[var(--radius-2xl)] bg-gradient-to-br from-[var(--color-accent-soft)] via-transparent to-transparent blur-2xl" />
          <ChatDemo className="w-full max-h-[640px] [&_div]:max-w-full" />
        </ScrollReveal>
      </div>
    </section>
  );
}

function HeroStat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-tertiary)]">
        {label}
      </dt>
      <dd className="text-[18px] font-semibold leading-none text-[var(--color-text-primary)]">
        {value}
      </dd>
      <span className="text-[11px] text-[var(--color-text-tertiary)]">{detail}</span>
    </div>
  );
}
