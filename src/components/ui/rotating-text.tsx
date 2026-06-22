"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { cn } from "@/lib/utils";

interface RotatingTextProps {
  /** 备选词组列表 */
  words: string[];
  /** 旋转间隔 (ms)，默认 2200 */
  interval?: number;
  /** 前缀文字，如 "正在" */
  prefix?: string;
  /** 后缀文字 */
  suffix?: string;
  /** 是否随机打乱词组顺序，默认 true */
  shuffle?: boolean;
  className?: string;
  /** 内层单字容器 className */
  wordClassName?: string;
}

const EXIT_MS = 260;
const ENTER_MS = 320;

/**
 * 类似 reactbits.dev/text-animations/rotating-text 的旋转文字动画:
 *  - 出场词向上滑出 + 轻微模糊淡出
 *  - 入场词从下方滑入 + 解除模糊淡入
 *  - 容器固定高度避免布局抖动
 *  - 父容器 aria-live="polite", 屏幕阅读器随每次切换朗读新词
 */
export function RotatingText({
  words,
  interval = 2200,
  prefix = "",
  suffix = "",
  shuffle = true,
  className,
  wordClassName,
}: RotatingTextProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [phase, setPhase] = useState<"idle" | "exiting" | "entering">("idle");
  const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined);
  const measureRef = useRef<HTMLSpanElement | null>(null);
  const phaseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const rotateTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  // 一次性随机洗牌:仅在组件挂载时执行,顺序在生命周期内稳定
  const [shuffleSeed] = useState(() => Math.random());
  const orderedWords = useMemo(() => {
    if (!shuffle) return words;
    const arr = [...words];
    // 基于 seed 的 Fisher-Yates 洗牌,纯函数且与 props 变化同步
    let seed = Math.floor(shuffleSeed * 0x7fffffff) || 1;
    for (let i = arr.length - 1; i > 0; i -= 1) {
      seed = (seed * 1103515245 + 12345) % 0x7fffffff;
      const j = seed % (i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }, [words, shuffle, shuffleSeed]);

  // 退出 -> 进入 -> 静止 循环,让单帧样式干净
  useEffect(() => {
    rotateTimer.current = setInterval(() => {
      setPhase("exiting");
      phaseTimer.current = setTimeout(() => {
        setCurrentIndex((prev) => (prev + 1) % orderedWords.length);
        setPhase("entering");
        phaseTimer.current = setTimeout(() => setPhase("idle"), ENTER_MS);
      }, EXIT_MS);
    }, interval);

    return () => {
      clearInterval(rotateTimer.current);
      if (phaseTimer.current) clearTimeout(phaseTimer.current);
    };
  }, [orderedWords, interval]);

  // 预测量最长词,固定容器高度防止布局抖动
  useEffect(() => {
    if (!measureRef.current) return;
    const node = measureRef.current;
    let max = 0;
    for (const word of orderedWords) {
      node.textContent = word;
      max = Math.max(max, node.offsetHeight);
    }
    setMaxHeight(max);
  }, [orderedWords]);

  const currentWord = orderedWords[currentIndex] || words[0];

  return (
    <span
      className={cn(
        "relative inline-flex items-baseline align-baseline",
        className
      )}
      aria-live="polite"
    >
      {prefix && <span>{prefix}</span>}
      <span
        className={cn(
          "relative inline-block overflow-hidden align-baseline",
          "min-w-[1ch]"
        )}
        style={{ height: maxHeight ? `${maxHeight}px` : undefined }}
      >
        <span
          key={currentIndex}
          className={cn(
            "inline-block will-change-transform transition-[transform,opacity,filter] ease-out",
            phase === "exiting" &&
              "duration-[260ms] -translate-y-1 opacity-0 blur-[2px]",
            phase === "entering" &&
              "duration-[320ms] translate-y-0 opacity-100 blur-0",
            phase === "idle" && "duration-[200ms] translate-y-0 opacity-100 blur-0",
            wordClassName
          )}
        >
          {currentWord}
        </span>
      </span>
      {/* 测量节点:不可见,仅用于量高度 */}
      <span
        ref={measureRef}
        aria-hidden
        className={cn(
          "invisible pointer-events-none absolute left-0 top-0 inline-block whitespace-nowrap",
          wordClassName
        )}
      />
      {suffix && <span>{suffix}</span>}
    </span>
  );
}
