"use client";

import {
  cubicBezier,
  motion,
  useMotionTemplate,
  useScroll,
  useTransform,
} from "motion/react";
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
 * 滚动场景揭示：元素进入、停留和离开时均与阅读位置连续对应。
 * - 不使用一次性 `whileInView`，反向滚动也能自然回到当前状态
 * - 以非线性曲线分配淡入和淡出的视觉进程，而非固定延迟
 * - prefers-reduced-motion: 退化为直接可见
 * - 永远渲染 motion.div，需要不同语义的元素时由调用方在 children 里自行包裹
 */
export function ScrollReveal({
  children,
  className,
  yOffset = 24,
}: ScrollRevealProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const reduced = usePrefersReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start 92%", "start 62%", "end 48%", "end 12%"],
  });
  const opacity = useTransform(
    scrollYProgress,
    [0, 0.2, 0.72, 1],
    [0, 1, 1, 0],
    {
      ease: [
        cubicBezier(0.22, 1, 0.36, 1),
        cubicBezier(0.22, 1, 0.36, 1),
        cubicBezier(0.65, 0, 0.35, 1),
      ],
    }
  );
  const y = useTransform(
    scrollYProgress,
    [0, 0.2, 0.72, 1],
    [yOffset, 0, 0, -Math.round(yOffset * 0.45)]
  );
  const transform = useMotionTemplate`translate3d(0, ${y}px, 0)`;

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
      style={{ opacity, transform }}
    >
      {children}
    </motion.div>
  );
}
