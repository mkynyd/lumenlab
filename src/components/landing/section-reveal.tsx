"use client";

import {
  cubicBezier,
  motion,
  useMotionTemplate,
  useScroll,
  useTransform,
} from "motion/react";
import { useRef } from "react";
import { usePrefersReducedMotion } from "./prefers-motion";

interface SectionRevealProps extends React.HTMLAttributes<HTMLElement> {
  innerClassName?: string;
  yOffset?: number;
}

/**
 * 全屏功能场景：内容在章节进入、阅读中心和离开时完成淡入、停留和淡出。
 * 这让连续章节拥有 Apple 宣传页式的滚动叙事，而无需滚动吸附。
 * - prefers-reduced-motion: 退化为直接可见
 */
export function SectionReveal({
  children,
  className = "",
  innerClassName = "",
  yOffset = 24,
  ...rest
}: SectionRevealProps) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const reduced = usePrefersReducedMotion();
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start end", "start 58%", "end 42%", "end start"],
  });
  const opacity = useTransform(
    scrollYProgress,
    [0, 0.18, 0.78, 1],
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
    [0, 0.18, 0.78, 1],
    [yOffset, 0, 0, -Math.round(yOffset * 0.45)]
  );
  const transform = useMotionTemplate`translate3d(0, ${y}px, 0)`;

  if (reduced) {
    return (
      <section ref={sectionRef} className={className} {...rest}>
        <div ref={innerRef} className={innerClassName}>
          {children}
        </div>
      </section>
    );
  }

  return (
    <section ref={sectionRef} className={className} {...rest}>
      <motion.div
        ref={innerRef}
        className={innerClassName}
        style={{ opacity, transform }}
      >
        {children}
      </motion.div>
    </section>
  );
}
