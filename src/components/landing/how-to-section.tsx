"use client";

import { Copy, Terminal } from "lucide-react";
import { ScrollReveal } from "./scroll-reveal";
import { MOCK_HOW_TO_STEPS } from "@/lib/mock/landing-fixtures";

/**
 * 使用方法：三步 + 命令块。
 * 视觉靠"步骤编号 + 命令 + 注脚"三件套区分层级，不放 icon+title+text 的重复卡片。
 */
export function HowToSection() {
  return (
    <section
      id="how-to"
      aria-label="上手步骤"
      className="relative bg-[var(--color-bg)] py-20 sm:py-28"
    >
      <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">
        <ScrollReveal>
          <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-tertiary)]">
            上手
          </p>
          <h2
            className="mt-3 max-w-[22ch] text-[clamp(1.875rem,3.6vw,2.75rem)] font-semibold leading-[1.12] tracking-[-0.025em] text-[var(--color-text-primary)]"
            style={{ textWrap: "balance" }}
          >
            三条命令，从克隆到第一条对话。
          </h2>
          <p
            className="mt-4 max-w-[58ch] text-[15px] leading-relaxed text-[var(--color-text-secondary)]"
            style={{ textWrap: "pretty" }}
          >
            项目自托管；下面三步是推荐的开发启动流程。生产环境另行参考部署文档。
          </p>
        </ScrollReveal>

        <ol className="mt-12 flex flex-col gap-10">
          {MOCK_HOW_TO_STEPS.map((step, i) => (
            <li key={step.index}>
              <ScrollReveal delay={i * 0.05}>
                <article className="grid gap-4 sm:grid-cols-[auto_1fr] sm:gap-6">
                <div className="flex items-start gap-3">
                  <span
                    className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-surface)] text-[14px] font-semibold text-[var(--color-text-primary)]"
                    aria-hidden
                  >
                    {String(step.index).padStart(2, "0")}
                  </span>
                </div>
                <div className="min-w-0">
                  <h3 className="text-[18px] font-semibold leading-snug text-[var(--color-text-primary)]">
                    {step.title}
                  </h3>
                  <p className="mt-1.5 text-[14px] leading-relaxed text-[var(--color-text-secondary)]">
                    {step.description}
                  </p>

                  <div className="mt-4 flex items-center gap-2 rounded-[var(--radius-lg)] bg-[var(--color-surface)] px-3 py-2.5">
                    <Terminal size={14} className="shrink-0 text-[var(--color-text-tertiary)]" />
                    <code className="flex-1 truncate font-mono text-[12.5px] text-[var(--color-text-primary)]">
                      {step.command}
                    </code>
                    <button
                      type="button"
                      disabled
                      aria-label="复制命令"
                      className="flex size-7 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-secondary)]"
                    >
                      <Copy size={12} />
                    </button>
                  </div>

                  <p className="mt-2.5 text-[12.5px] leading-relaxed text-[var(--color-text-tertiary)]">
                    {step.note}
                  </p>
                </div>
              </article>
              </ScrollReveal>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
