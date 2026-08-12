"use client";

import { ScrollReveal } from "./scroll-reveal";
import { LearningGoalDemo } from "./demos/learning-goal-demo";

const STEPS = [
  {
    title: "创建学习目标",
    body: "写下要学什么、为什么学，以及目标日期和每天能投入的时间。",
  },
  {
    title: "确认学习范围",
    body: "勾选纳入学习范围的课程资料，资料缺口会单独标出，确认后才生成地图。",
  },
  {
    title: "生成地图并开始诊断",
    body: "知识点地图生成后，从一轮诊断练习开始，之后按计划练习和复习。",
  },
];

/**
 * 学习上手板块：用真实「学习目标」流程精简展示学习闭环的起步路径。
 */
export function LearningHowToSection() {
  return (
    <section
      id="learning-how-to"
      aria-label="三步开始学习"
      className="relative py-24 sm:py-36"
    >
      <div className="mx-auto grid w-full max-w-7xl gap-14 px-4 sm:px-6 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] lg:gap-20">
        <ScrollReveal className="flex flex-col justify-center">
          <p className="text-[13px] font-medium text-[var(--color-accent)]">
            学习闭环
          </p>
          <h2 className="mt-4 whitespace-nowrap text-[clamp(2rem,4.6vw,4rem)] font-semibold leading-[1.04] tracking-[-0.04em] text-[var(--color-text-primary)]">
            三步开始学习。
          </h2>
          <p
            className="mt-6 max-w-[42ch] text-[16px] leading-7 text-[var(--color-text-secondary)]"
            style={{ textWrap: "pretty" }}
          >
            在项目里定下目标、圈定资料，LumenLab 会安排好接下来的诊断和复习。
          </p>

          <ol className="mt-10 border-t border-[var(--color-border-light)]">
            {STEPS.map((step, index) => (
              <li
                key={index}
                className="grid grid-cols-[30px_minmax(0,1fr)] gap-3 border-b border-[var(--color-border-light)] py-5"
              >
                <span className="pt-0.5 text-[12px] font-medium tabular-nums text-[var(--color-text-tertiary)]">
                  0{index + 1}
                </span>
                <div>
                  <h3 className="text-[15px] font-semibold leading-snug text-[var(--color-text-primary)]">
                    {step.title}
                  </h3>
                  <p className="mt-1.5 max-w-[42ch] text-[14px] leading-6 text-[var(--color-text-secondary)]">
                    {step.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </ScrollReveal>

        <ScrollReveal
          scale
          yOffset={20}
          className="overflow-hidden rounded-[28px] bg-[var(--color-surface)] ring-1 ring-[var(--color-border-light)]"
        >
          <LearningGoalDemo />
        </ScrollReveal>
      </div>
    </section>
  );
}
