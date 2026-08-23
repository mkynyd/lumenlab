import Link from "next/link";
import { LayoutLeft } from "iconoir-react";

export default function PaperTypesettingPage() {
  return <main className="h-full overflow-y-auto bg-[var(--color-bg)]"><div className="mx-auto max-w-4xl px-5 py-10 sm:px-8"><Link href="/papers" className="text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]">← 我的论文</Link><div className="mt-6 flex items-start gap-4"><LayoutLeft className="text-[var(--color-accent)]" width={28} height={28} strokeWidth={1.5} /><div><h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">论文排版</h1><p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">选择模板、编辑结构化 Document、插入图表公式并排队真实编译。模板与文档版本会长期锁定。</p></div></div><div className="mt-10 bg-[var(--color-panel)] px-5 py-6 text-sm leading-7 text-[var(--color-text-secondary)]">排版能力可以完全不调用 AI：先从「我的论文」创建空白文档，再选择模板并保存版本。编译 Worker 和完整 Template Pack 验证会沿用当前阶段的后台接口。</div></div></main>;
}
