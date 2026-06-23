"use client";

import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type FeatureAlign = "left" | "right" | "triple";

interface FeatureBlockProps {
  /** 第几个功能（1-based），用于左上角小字编号。 */
  index: number;
  /** 副标 / 类型小字。 */
  eyebrow: string;
  /** 标题（2-4 字中文为佳）。 */
  title: string;
  /** 单段描述。 */
  description: string;
  /** 该块展示用的 React 节点（demo 组件）。 */
  demo: ReactNode;
  /** 排版朝向，控制 demo 和文字的左右位置。 */
  align: FeatureAlign;
  /** 第三个 demo 用的三列细列（仅 triple 使用）。 */
  tripleHighlights?: Array<{ label: string; value: string }>;
  className?: string;
}

/**
 * 单个功能展示块。三个 align 各有不同排版：
 *  - "left"   ：文字在左，demo 在右
 *  - "right"  ：demo 在左，文字在右
 *  - "triple" ：demo 全宽居中，底部三列细列
 * 全部遵守"无边框、无深灰 hover、文字层级驱动"的品牌约束。
 */
export function FeatureBlock({
  index,
  eyebrow,
  title,
  description,
  demo,
  align,
  tripleHighlights,
  className,
}: FeatureBlockProps) {
  if (align === "triple") {
    return (
      <article
        className={cn(
          "flex h-full w-full flex-col gap-8 px-2 sm:px-6",
          className
        )}
      >
        <div className="grid gap-3 sm:grid-cols-[auto_1fr_auto] sm:items-end">
          <FeatureHeading index={index} eyebrow={eyebrow} title={title} description={description} />
        </div>

        <div className="flex-1">{demo}</div>

        {tripleHighlights && tripleHighlights.length > 0 && (
          <dl className="grid grid-cols-1 gap-3 border-t border-[var(--color-border-light)] pt-5 sm:grid-cols-3">
            {tripleHighlights.map((item) => (
              <div key={item.label} className="flex flex-col gap-0.5">
                <dt className="text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-tertiary)]">
                  {item.label}
                </dt>
                <dd className="text-[15px] font-semibold text-[var(--color-text-primary)]">
                  {item.value}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </article>
    );
  }

  const isRight = align === "right";
  return (
    <article
      className={cn(
        "grid h-full w-full grid-cols-1 items-center gap-8 px-2 sm:px-6 md:grid-cols-2 md:gap-10 lg:gap-14",
        className
      )}
    >
      <div className={cn("order-1", isRight ? "md:order-1" : "md:order-2")}>
        {demo}
      </div>
      <div className={cn("order-2 flex flex-col gap-5", isRight ? "md:order-2" : "md:order-1")}>
        <FeatureHeading index={index} eyebrow={eyebrow} title={title} description={description} />
      </div>
    </article>
  );
}

function FeatureHeading({
  index,
  eyebrow,
  title,
  description,
}: {
  index: number;
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-tertiary)]">
        <span className="tabular-nums">0{index}</span>
        <span aria-hidden className="h-px w-6 bg-[var(--color-border)]" />
        <span>{eyebrow}</span>
      </div>
      <h2
        className="text-[clamp(1.75rem,3.4vw,2.75rem)] font-semibold leading-[1.1] tracking-[-0.025em] text-[var(--color-text-primary)]"
        style={{ textWrap: "balance" }}
      >
        {title}
      </h2>
      <p
        className="max-w-[48ch] text-[15px] leading-relaxed text-[var(--color-text-secondary)] sm:text-[16px]"
        style={{ textWrap: "pretty" }}
      >
        {description}
      </p>
    </div>
  );
}
