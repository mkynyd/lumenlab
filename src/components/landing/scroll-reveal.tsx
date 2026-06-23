"use client";

import { motion, useInView, type UseInViewOptions } from "motion/react";
import { useRef, type ReactNode } from "react";
import { usePrefersReducedMotion } from "./prefers-motion";

interface ScrollRevealProps {
  children: ReactNode;
  /** 触发延迟（秒），用于多个相邻块的 stagger。 */
  delay?: number;
  /** 元素进入视窗的比例。默认 0.18（首段可见即触发）。 */
  amount?: UseInViewOptions["amount"];
  /** Y 方向位移幅度（px），默认 24。 */
  yOffset?: number;
  /** 入场时长（秒），默认 0.6。 */
  duration?: number;
  className?: string;
}

/**
 * 入场揭示：元素第一次进入视窗时淡入 + 轻微上移。
 *  - 桌面端用于 hero / how-to / footer 的滚动入场
 *  - 移动端因 feature-rail 已退化为垂直堆叠，本组件继续工作
 *  - prefers-reduced-motion: 退化为直接可见
 *  - 永远渲染 motion.div，需要不同语义的元素时由调用方在 children 里自行包裹
 */
export function ScrollReveal({
  children,
  delay = 0,
  amount = 0.18,
  yOffset = 24,
  duration = 0.6,
  className,
}: ScrollRevealProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const inView = useInView(ref, { amount, once: true });
  const reduced = usePrefersReducedMotion();

  if (reduced) {
    return (
      <div ref={ref} className={className}>
        {children}
      </div>
    );
  }

  return (
    <motion.div
      ref={ref}
      className={className}
      initial={{ opacity: 0, y: yOffset }}
      animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: yOffset }}
      transition={{
        duration,
        delay,
        ease: [0.16, 1, 0.3, 1],
      }}
    >
      {children}
    </motion.div>
  );
}
