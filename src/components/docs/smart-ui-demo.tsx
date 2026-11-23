"use client";

import { OhmLabDemo } from "@/components/intelligent-ui/ohm-lab-demo";

/**
 * 文档内真实交互示例。数据与落地页共用，不发起聊天或 INP 请求。
 */
export function DocsSmartUiDemo() {
  return (
    <figure className="my-6 overflow-hidden rounded-[20px] border border-[var(--color-border-light)] bg-[var(--color-surface)]">
      <div className="border-b border-[var(--color-border-light)] bg-[var(--color-panel)] px-4 py-2.5 text-[12px] font-medium text-[var(--color-text-secondary)]">
        可交互示例 · 电路实验
      </div>
      <div className="p-3 sm:p-4">
        <OhmLabDemo />
      </div>
      <figcaption className="border-t border-[var(--color-border-light)] px-4 py-2.5 text-[11px] text-[var(--color-text-tertiary)]">
        拖动滑杆会重算电流和功率。示例数据为理想电阻，不代表真实实验结果。
      </figcaption>
    </figure>
  );
}
