"use client";

import { Sparkles } from "lucide-react";
import { OhmLabDemo } from "@/components/intelligent-ui/ohm-lab-demo";

/**
 * 落地页智能界面演示：与 /chat 共用真实渲染器，数据是静态演示数据。
 */
export function SmartUiDemo() {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[inherit] bg-[var(--color-surface)]">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--color-border-light)] bg-[var(--color-panel)] px-4">
        <span className="text-[13px] font-medium text-[var(--color-text-primary)]">电路实验 · 项目对话</span>
        <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-surface-active)] px-2 py-1 text-[11px] text-[var(--color-text-secondary)]">
          <Sparkles size={11} />
          智能界面
        </span>
      </div>

      <div className="min-h-0 flex-1 space-y-4 bg-[var(--color-bg)] px-4 py-5 sm:px-6 sm:py-6">
        <div className="flex justify-end">
          <p className="max-w-[82%] rounded-[18px] bg-[var(--color-surface-active)] px-3.5 py-2.5 text-[13px] leading-relaxed text-[var(--color-text-primary)]">
            把电阻从 4Ω 调到 10Ω，电流和功率会怎么变？
          </p>
        </div>

        <div className="min-w-0">
          <p className="max-w-[68ch] text-[13px] leading-relaxed text-[var(--color-text-primary)]">
            电压恒为 6 V。由欧姆定律，电流与电阻成反比；功率按 P = U²/R 变化。拖动下面的滑杆，读数和柱状图会一起更新。
          </p>
          <div className="mt-3 rounded-[20px] border border-[var(--color-border-light)] bg-[var(--color-panel)] p-2 sm:p-3">
            <OhmLabDemo />
          </div>
          <p className="mt-2 text-[11px] text-[var(--color-text-tertiary)]">真实交互组件 · 数值随滑杆实时计算</p>
        </div>
      </div>
    </div>
  );
}
