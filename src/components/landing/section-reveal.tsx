"use client";

import { motion } from "motion/react";
import { useRef } from "react";
import { usePrefersReducedMotion } from "./prefers-motion";

interface SectionRevealProps extends React.HTMLAttributes<HTMLElement> {
  innerClassName?: string;
  yOffset?: number;
}

/**
 * 纵向 section reveal：内容第一次进入视口时淡入并轻微上滑。
 * - viewport amount 0.2：尽早显示，不重复播放
 * - 过渡时长 0.24s，strong ease-out
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
        initial={{ opacity: 0, transform: `translateY(${yOffset}px)` }}
        whileInView={{ opacity: 1, transform: "translateY(0px)" }}
        viewport={{ once: true, amount: 0.2 }}
        transition={{ duration: 0.24, ease: [0.23, 1, 0.32, 1] }}
      >
        {children}
      </motion.div>
    </section>
  );
}
