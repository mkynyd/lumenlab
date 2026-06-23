"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AnimatePresence,
  motion,
  type TargetAndTransition,
  type Transition,
} from "motion/react";
import { cn } from "@/lib/utils";

/**
 * 旋转文字动画 —— 复刻 reactbits.dev/text-animations/rotating-text 效果:
 *  - 每个字符独立做 enter/exit 动画,带可选 stagger
 *  - 旋转容器(rotatingWrapper)带 layout 动画,不同长度的词切换时宽度丝滑过渡
 *  - 内部使用 AnimatePresence mode="popLayout",旧字符退场时新字符已就位,避免布局抖动
 *  - 屏幕阅读器通过 aria-live="polite" 在每次切换时朗读新文本
 */

interface RotatingTextProps {
  /** 旋转文本数组 */
  texts: string[];
  /** 旋转间隔 (ms)，默认 2200 */
  interval?: number;
  /** 稳定前缀，如 "Lumen" */
  prefix?: string;
  /** 每个字符的进场延迟 (s)，默认 0.025 */
  staggerDuration?: number;
  /** 字符进场样式 */
  initial?: TargetAndTransition;
  /** 字符展示样式 */
  animate?: TargetAndTransition;
  /** 字符退场样式 */
  exit?: TargetAndTransition;
  /** motion 过渡配置 */
  transition?: Transition;
  /** AnimatePresence 模式，默认 popLayout 让字符切换丝滑 */
  animatePresenceMode?: "sync" | "wait" | "popLayout";
  /** 整个组件外层 (Lumen + 卡片) */
  mainClassName?: string;
  /** 稳定前缀样式 (Lumen 部分) */
  prefixClassName?: string;
  /** 旋转文字最外层 —— 通常用来做卡片背景 */
  rotatingWrapperClassName?: string;
  /** 每个单词的内层 flex */
  splitLevelClassName?: string;
  /** 每个字符的样式 */
  elementLevelClassName?: string;
  /** 切换时回调 */
  onNext?: (index: number) => void;
}

export interface RotatingTextRef {
  next: () => void;
  previous: () => void;
  jumpTo: (index: number) => void;
  reset: () => void;
}

const DEFAULT_TRANSITION: Transition = { type: "spring", damping: 28, stiffness: 320, mass: 0.6 };

// 卡片宽度过渡使用 tween，避免 spring overshoot 让 prefix 和卡片相对位置抖动
const LAYOUT_TRANSITION: Transition = { type: "tween", duration: 0.5, ease: [0.16, 1, 0.3, 1] };

const DEFAULT_INITIAL: TargetAndTransition = { y: "100%", opacity: 0 };
const DEFAULT_ANIMATE: TargetAndTransition = { y: 0, opacity: 1 };
const DEFAULT_EXIT: TargetAndTransition = { y: "-120%", opacity: 0 };

export const RotatingText = forwardRef<RotatingTextRef, RotatingTextProps>(
  function RotatingText(
    {
      texts,
      interval = 2200,
      prefix,
      staggerDuration = 0.025,
      initial = DEFAULT_INITIAL,
      animate = DEFAULT_ANIMATE,
      exit = DEFAULT_EXIT,
      transition = DEFAULT_TRANSITION,
      animatePresenceMode = "popLayout",
      mainClassName,
      prefixClassName,
      rotatingWrapperClassName,
      splitLevelClassName,
      elementLevelClassName,
      onNext,
    },
    ref
  ) {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
    const onNextRef = useRef(onNext);
    onNextRef.current = onNext;

    // 检测 reduced-motion 偏好
    useEffect(() => {
      if (typeof window === "undefined" || !window.matchMedia) return;
      const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
      setPrefersReducedMotion(mql.matches);
      const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
      mql.addEventListener("change", handler);
      return () => mql.removeEventListener("change", handler);
    }, []);

    // 切词
    const goTo = useCallback((next: number) => {
      setCurrentIndex((prev) => {
        if (next === prev) return prev;
        onNextRef.current?.(next);
        return next;
      });
    }, []);

    const next = useCallback(() => {
      setCurrentIndex((prev) => {
        const target = (prev + 1) % texts.length;
        onNextRef.current?.(target);
        return target;
      });
    }, [texts.length]);

    const previous = useCallback(() => {
      setCurrentIndex((prev) => {
        const target = prev === 0 ? texts.length - 1 : prev - 1;
        onNextRef.current?.(target);
        return target;
      });
    }, [texts.length]);

    const jumpTo = useCallback(
      (index: number) => {
        const validIndex = Math.max(0, Math.min(index, texts.length - 1));
        goTo(validIndex);
      },
      [texts.length, goTo]
    );

    const reset = useCallback(() => goTo(0), [goTo]);

    useImperativeHandle(ref, () => ({ next, previous, jumpTo, reset }), [
      next,
      previous,
      jumpTo,
      reset,
    ]);

    useEffect(() => {
      const id = window.setInterval(next, interval);
      return () => window.clearInterval(id);
    }, [next, interval]);

    const currentText = texts[currentIndex] ?? "";

    // 把当前文本切成 单词 -> 字符 的两级结构
    const elements = useMemo(() => {
      const words = currentText.split(" ");
      return words.map((word, i, arr) => ({
        characters: Array.from(word),
        needsSpace: i !== arr.length - 1,
      }));
    }, [currentText]);

    // reduced-motion: 直接展示当前文本，不做动画
    if (prefersReducedMotion) {
      return (
        <span className={cn("inline-flex items-baseline", mainClassName)} aria-live="polite">
          {prefix && <span className={prefixClassName}>{prefix}&nbsp;</span>}
          <span className={rotatingWrapperClassName} aria-hidden="true">
            <span className={cn("inline-block", elementLevelClassName)}>{currentText}</span>
          </span>
        </span>
      );
    }

    return (
      <motion.span
        layout
        transition={LAYOUT_TRANSITION}
        className={cn("inline-flex items-baseline", mainClassName)}
        aria-live="polite"
      >
        {prefix && <span className={prefixClassName}>{prefix}&nbsp;</span>}
        <span
          className={cn(
            "relative inline-block overflow-hidden",
            rotatingWrapperClassName
          )}
        >
          <AnimatePresence mode={animatePresenceMode} initial={false}>
            <motion.span
              key={currentIndex}
              className="inline-flex flex-wrap whitespace-pre-wrap relative"
              aria-hidden="true"
            >
              {elements.map((word, wordIndex, array) => {
                const previousChars = array
                  .slice(0, wordIndex)
                  .reduce((sum, w) => sum + w.characters.length, 0);
                return (
                  <span
                    key={wordIndex}
                    className={cn("inline-flex", splitLevelClassName)}
                  >
                    {word.characters.map((char, charIndex) => (
                      <motion.span
                        key={`${currentIndex}-${wordIndex}-${charIndex}`}
                        initial={initial}
                        animate={animate}
                        exit={exit}
                        transition={{
                          ...transition,
                          delay: (previousChars + charIndex) * staggerDuration,
                        }}
                        className={cn("inline-block", elementLevelClassName)}
                      >
                        {char}
                      </motion.span>
                    ))}
                    {word.needsSpace && (
                      <span className="inline-block whitespace-pre"> </span>
                    )}
                  </span>
                );
              })}
            </motion.span>
          </AnimatePresence>
        </span>
      </motion.span>
    );
  }
);