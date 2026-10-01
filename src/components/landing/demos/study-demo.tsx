"use client";

import { BookOpen, CalendarDays, ScanLine } from "lucide-react";

const illustrations = {
  capture: { icon: ScanLine, title: "选择需要保存的错题", lines: ["考研数学二 · 极限专题", "第 3 题 · 已选择题干与插图", "第 7 题 · 已绑定跨页内容", "收录到：数学错题本"] },
  analysis: { icon: BookOpen, title: "自动处理与核验", lines: ["识别完整题干、选项与公式", "关联题目插图与公共材料", "检索参考来源，独立求解", "核验通过后展示解析"] },
  calendar: { icon: CalendarDays, title: "学习日程预览", lines: ["周一 08:30 · 数据结构课", "周二 18:00 · 作业截止", "空闲时段 · 错题复习", "确认安排后写入日历"] },
};

/** Marketing illustration only; these rows are not persisted study records. */
export function StudyDemo({ mode, className = "" }: { mode: keyof typeof illustrations; className?: string }) {
  const { icon: Icon, title, lines } = illustrations[mode];
  return <div className={`flex min-h-80 flex-col justify-center gap-6 bg-[var(--color-surface)] p-8 ${className}`}>
    <div className="flex items-center gap-3 text-[var(--color-accent)]"><Icon size={24} /><h3 className="text-lg font-semibold">{title}</h3></div>
    <div className="space-y-3">{lines.map((line, index) => <div key={line} className="flex gap-4 rounded-xl bg-[var(--color-surface-hover)] p-4 text-sm"><span className="text-[var(--color-accent)]">0{index + 1}</span><span>{line}</span></div>)}</div>
    <p className="text-xs text-[var(--color-text-tertiary)]">流程示意</p>
  </div>;
}
