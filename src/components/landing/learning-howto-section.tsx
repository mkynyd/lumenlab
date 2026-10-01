"use client";

import { ScrollReveal } from "./scroll-reveal";
import { StudyDemo } from "./demos/study-demo";

const STEPS = [
  {
    title: "创建题集",
    body: "选择学段、学科与考试范围，建立自己的错题本。",
  },
  {
    title: "选择错题",
    body: "上传材料后框选需要保存的题目，或从已核验题库中多选。",
  },
  {
    title: "查看解析与日程",
    body: "查看后台处理进度，并在日历中安排课程和截止任务。",
  },
];

/**
 * 学习上手板块：用真实「错题与日程」流程精简展示学习闭环的起步路径。
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
          <h2 className="whitespace-nowrap text-[clamp(2rem,4.6vw,4rem)] font-semibold leading-[1.04] tracking-[-0.04em] text-[var(--color-accent)]">
            错题与日程
          </h2>
          <p
            className="mt-6 max-w-[42ch] text-[16px] leading-7 text-[var(--color-text-secondary)]"
            style={{ textWrap: "pretty" }}
          >
            在题集中整理错题，用日历安排课程、作业与学习时间。
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
          className="overflow-hidden rounded-[28px] bg-[var(--color-surface)]"
        >
          <StudyDemo mode="capture" />
        </ScrollReveal>
      </div>
    </section>
  );
}
