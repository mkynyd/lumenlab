import { cn } from "@/lib/utils";

/**
 * LumenLab 字标（wordmark）：`Lumen` 用 Saira SemiBold，`Lab` 用 Lexend Medium。
 *
 * 配套字体是只含品牌名字符的 woff2 子集（`public/fonts/brand/`），因此这个组件
 * 只能渲染 "LumenLab" 本身，不要用它承载其他文案 —— 子集里没有别的字形。
 *
 * `Lab` 取主题 accent 色：浅色模式即设计稿的 #006BFF，深色模式自动切到更亮的蓝。
 * `Lumen` 不设颜色、随调用处的文字色走，品牌位 hover 变蓝的交互因此保持不变。
 * 字距 -0.04em 对应设计稿里 -40 的 tracking 值。
 */
export function BrandWordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-block whitespace-nowrap tracking-[-0.04em]",
        className
      )}
    >
      <span className="font-brand-lumen font-semibold">Lumen</span>
      <span className="font-brand-lab font-medium text-[var(--color-accent)]">
        Lab
      </span>
    </span>
  );
}
