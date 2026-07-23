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
 * 上手板块：用真实「新建项目」页面同款 UI 代码精简到主页做静态演示。
 * 步骤编号用于表达真实顺序，而不是装饰性节奏；采用垂直时间线强化进程感。
 */
export function HowToSection() {
  return (
    <section
      id="how-to"
      aria-label="三步建项目"
      className="relative flex min-h-screen items-center py-24 sm:py-36"
    >
      <div className="mx-auto grid w-full max-w-7xl gap-14 px-4 sm:px-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] md:gap-16 lg:gap-20">
        <ScrollReveal className="flex flex-col justify-center">
          <p className="text-[15px] font-medium text-[var(--color-accent)]">
            上手
          </p>
          <h2
            className="mt-4 max-w-[12ch] text-[clamp(1.875rem,4.2vw,3rem)] font-semibold leading-[1.1] tracking-[-0.025em] text-[var(--color-text-primary)]"
            style={{ textWrap: "balance" }}
          >
            三步建一个项目
          </h2>
          <p
            className="mt-5 max-w-[46ch] text-[16px] leading-[1.65] text-[var(--color-text-secondary)]"
            style={{ textWrap: "pretty" }}
          >
            进入「项目空间」新建项目：填名、选类型、告诉 AI 你的场景。
            系统会生成项目提示词与推荐快捷任务，确认后即可开始。
          </p>

          <ol className="relative mt-10 flex flex-col gap-0">
            {STEPS.map((step, index) => (
              <li key={index} className="relative pl-11 pb-8 last:pb-0">
                {index < STEPS.length - 1 && (
                  <span
                    className="absolute left-[18px] top-9 h-[calc(100%-24px)] w-px bg-[var(--color-border-light)]"
                    aria-hidden
                  />
                )}
                <span
                  className="absolute left-0 top-0 flex size-9 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-accent)] text-[14px] font-semibold text-[var(--color-accent-contrast)]"
                  aria-hidden
                >
                  {index + 1}
                </span>
                <h3 className="text-[17px] font-semibold leading-snug text-[var(--color-text-primary)]">
                  {step.title}
                </h3>
                <p className="mt-1.5 max-w-[46ch] text-[15px] leading-[1.6] text-[var(--color-text-secondary)]">
                  {step.body}
                </p>
              </li>
            ))}
          </ol>
        </ScrollReveal>

        <ScrollReveal delay={0.08} yOffset={28}>
          <ProjectCreateDemo />
        </ScrollReveal>
      </div>
    </section>
  );
}
