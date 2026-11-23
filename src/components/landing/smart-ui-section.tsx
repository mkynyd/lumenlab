"use client";

import { ScrollReveal } from "./scroll-reveal";
import { SmartUiDemo } from "./demos/smart-ui-demo";

const POINTS = [
  {
    title: "比较，并排看",
    body: "多个方案、参数或版本放在同一张卡片里，差异不用来回翻正文。",
  },
  {
    title: "过程，逐步走",
    body: "状态迁移、算法步骤和实验阶段可以前后切换，停在关键节点看变化。",
  },
  {
    title: "变量，直接调",
    body: "滑杆、选项和图表联动。改一个条件，读数和结论立刻重算。",
  },
];

/**
 * 智能界面板块：与现有「创建项目」「学习上手」共用同一套滚动揭示和两栏语法。
 * 不插入 ProductStory 的 ScrollTrigger 时间线，避免打乱原有六章叙事。
 */
export function SmartUiSection() {
  return (
    <section
      id="smart-ui"
      aria-label="智能界面"
      className="relative py-24 sm:py-36"
    >
      <div className="mx-auto grid w-full max-w-7xl gap-14 px-4 sm:px-6 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] lg:gap-20">
        <ScrollReveal className="flex flex-col justify-center">
          <p className="mb-4 text-[12px] font-medium uppercase tracking-[0.18em] text-[var(--color-text-tertiary)]">
            智能界面
          </p>
          <h2 className="text-[clamp(2rem,4.6vw,4rem)] font-semibold leading-[1.04] tracking-[-0.04em] text-[var(--color-accent)]">
            答案可操作
          </h2>
          <p
            className="mt-6 max-w-[42ch] text-[16px] leading-7 text-[var(--color-text-secondary)]"
            style={{ textWrap: "pretty" }}
          >
            同一个问题，LumenLab 不只给结论。模型会按内容选择文字、流程图或可交互组件，让比较、过程和变量关系直接看得见。
          </p>

          <ol className="mt-10 border-t border-[var(--color-border-light)]">
            {POINTS.map((point, index) => (
              <li
                key={point.title}
                className="grid grid-cols-[30px_minmax(0,1fr)] gap-3 border-b border-[var(--color-border-light)] py-5"
              >
                <span className="pt-0.5 text-[12px] font-medium tabular-nums text-[var(--color-text-tertiary)]">
                  0{index + 1}
                </span>
                <div>
                  <h3 className="text-[15px] font-semibold leading-snug text-[var(--color-text-primary)]">
                    {point.title}
                  </h3>
                  <p className="mt-1.5 max-w-[42ch] text-[14px] leading-6 text-[var(--color-text-secondary)]">
                    {point.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>

          <p className="mt-6 text-[12px] leading-5 text-[var(--color-text-tertiary)]">
            简单定义和单步结论仍用文字，不为了界面而界面。
          </p>
        </ScrollReveal>

        <ScrollReveal
          scale
          yOffset={20}
          className="overflow-hidden rounded-[28px] bg-[var(--color-surface)] ring-1 ring-[var(--color-border-light)]"
        >
          <SmartUiDemo />
        </ScrollReveal>
      </div>
    </section>
  );
}
