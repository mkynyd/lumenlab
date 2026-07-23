"use client";

import { ScrollReveal } from "./scroll-reveal";
import { ProjectCreateDemo } from "./demos/project-create-demo";

const STEPS = [
  {
    title: "命名并选择项目类型",
    body: "给项目起一个名字，并从实验、复习、代码、通用四种类型中选择最贴近你当前任务的一项。",
  },
  {
    title: "描述使用场景",
    body: "用一两句话告诉 AI 你准备怎么使用这个项目，系统会据此生成项目提示词和推荐快捷任务。",
  },
  {
    title: "确认并进入工作台",
    body: "挑选需要的快捷任务，确认后进入项目。随后即可上传资料、开始对话或转换文档。",
  },
];

/**
 * 上手板块：用真实「新建项目」交互精简展示完整起步路径。
 */
export function HowToSection() {
  return (
    <section
      id="how-to"
      aria-label="三步建项目"
      className="relative py-24 sm:py-36"
    >
      <div className="mx-auto grid w-full max-w-7xl gap-14 px-4 sm:px-6 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] lg:gap-20">
        <ScrollReveal className="flex flex-col justify-center">
          <p className="text-[13px] font-medium text-[var(--color-accent)]">
            三步上手
          </p>
          <h2
            className="mt-4 max-w-[12ch] text-[clamp(2rem,4.6vw,4rem)] font-semibold leading-[1.04] tracking-[-0.04em] text-[var(--color-text-primary)]"
            style={{ textWrap: "balance" }}
          >
            先把下一门课放进来
          </h2>
          <p
            className="mt-6 max-w-[42ch] text-[16px] leading-7 text-[var(--color-text-secondary)]"
            style={{ textWrap: "pretty" }}
          >
            告诉 LumenLab 课程与任务场景，它会生成一份可调整的项目提示词和常用任务。
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
          yOffset={20}
          className="overflow-hidden rounded-[28px] bg-[var(--color-surface)] ring-1 ring-[var(--color-border-light)]"
        >
          <ProjectCreateDemo />
        </ScrollReveal>
      </div>
    </section>
  );
}
