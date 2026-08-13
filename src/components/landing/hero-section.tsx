"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { motion, type Variants } from "motion/react";
import { Button } from "@/components/ui/button";
import { RotatingText } from "@/components/ui/rotating-text";
import { ChatDemo } from "./demos/chat-demo";
import { ScrollReveal } from "./scroll-reveal";
import { usePrefersReducedMotion } from "./prefers-motion";

/**
 * Apple 宣传页式入场曲线：起步快、收尾长，无回弹。
 */
const HERO_EASE = [0.28, 0.11, 0.32, 1] as const;

const heroContainer: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.1, delayChildren: 0.05 },
  },
};

const heroItem: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 1, ease: HERO_EASE },
  },
};

/**
 * 居中的产品承诺 + 一块真实诊断练习界面预览。
 * 首屏文本在加载时错峰淡入上移，预览面板随滚动淡入并轻微放大。
 */
export function HeroSection() {
  const reduced = usePrefersReducedMotion();

  return (
    <section className="relative overflow-hidden pb-24 pt-24 sm:pb-32 sm:pt-32">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
        <motion.div
          initial={reduced ? false : "hidden"}
          animate="visible"
          variants={heroContainer}
          className="mx-auto flex max-w-5xl flex-col items-center text-center"
        >
          <motion.p
            variants={heroItem}
            className="text-[13px] font-medium leading-snug text-[var(--color-accent)]"
          >
            LumenLab · 大学生 AI 学习工作台
          </motion.p>

          <motion.h1
            variants={heroItem}
            className="mt-5 whitespace-nowrap text-[clamp(2.5rem,7.2vw,6.6rem)] font-semibold leading-[0.98] tracking-[-0.055em] text-[var(--color-text-primary)]"
          >
            开启你的
            <RotatingText
              texts={["聊天。", "学习。", "项目。"]}
              interval={2400}
              rotatingWrapperClassName="align-bottom"
            />
          </motion.h1>

          <motion.p
            variants={heroItem}
            className="mt-7 max-w-[54ch] text-[16px] leading-7 text-[var(--color-text-secondary)] sm:text-[18px] sm:leading-8"
            style={{ textWrap: "pretty" }}
          >
            课程资料、AI 对话、学习闭环和文档导出都在同一个项目里，不用反复切换工具。
          </motion.p>

          <motion.div
            variants={heroItem}
            className="mt-9 flex flex-wrap items-center justify-center gap-2"
          >
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
          </motion.div>
          <motion.p
            variants={heroItem}
            className="mt-3 text-[12px] text-[var(--color-text-tertiary)]"
          >
            Alpha 阶段免费 · 邮箱注册即可使用
          </motion.p>
        </motion.div>

        <ScrollReveal
          scale
          className="relative mx-auto mt-16 h-[520px] w-full max-w-6xl overflow-hidden rounded-[28px] bg-[var(--color-surface)] ring-1 ring-[var(--color-border-light)] sm:mt-20 sm:h-[640px] sm:rounded-[32px]"
          yOffset={24}
        >
          <ChatDemo className="h-full w-full" />
        </ScrollReveal>
      </div>
    </section>
  );
}
