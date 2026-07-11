"use client";

import { motion } from "motion/react";
import { useRef, type ReactNode } from "react";
import { usePrefersReducedMotion } from "./prefers-motion";

interface ScrollRevealProps {
  children: ReactNode;
  /** @deprecated 滚动 scrub 不再使用固定延迟，保留以免破坏调用方。 */
  delay?: number;
  /** @deprecated 滚动 scrub 不再使用固定入场时长，保留以免破坏调用方。 */
  amount?: number;
  /** Y 方向位移幅度（px），默认 24。 */
  yOffset?: number;
  /** @deprecated 滚动 scrub 不再使用固定入场时长，保留以免破坏调用方。 */
  duration?: number;
  className?: string;
}

/**
 * 滚动入场揭示：元素进入视口时淡入 + 轻微上移，离开视口时淡出。
 * - viewport amount 0.4：元素进入 40% 时触发
 * - 过渡时长 0.6s，ease-out
 * - prefers-reduced-motion: 退化为直接可见
 * - 永远渲染 motion.div，需要不同语义的元素时由调用方在 children 里自行包裹
 */
export function ScrollReveal({
  children,
  className,
}: ScrollRevealProps) {
  const ref = useRef<HTMLDivElement | null>(null);
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
      initial={false}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: false, amount: 0.4 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
