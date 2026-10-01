"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { holidaySource } from "@/lib/study/holidays";
import { Input } from "@/components/ui/input";
import type { PlannedBlock, TimeWindow } from "@/lib/study/planner";
type Plan = { blocks: PlannedBlock[]; unscheduled: { taskId: string; minutes: number }[]; taskTitles: Record<string, string>; feasible: boolean; version: string; asOf: string };
export function StudyPlanning({ onApplied }: { onApplied: () => Promise<void> }) {
  const [skipHolidays, setSkipHolidays] = useState(true);
  const [availability, setAvailability] = useState<TimeWindow[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [acceptIncomplete, setAcceptIncomplete] = useState(false);
  async function request(method: "POST" | "PUT") {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/study/planning", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(method === "POST" ? { availability, skipHolidays } : { availability, skipHolidays, version: plan?.version, asOf: plan?.asOf, confirmed: true, acceptIncomplete }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "规划失败");
      if (method === "POST") { setPlan(data); setAcceptIncomplete(false); }
      else { setPlan(null); await onApplied(); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "规划失败"); }
    finally { setBusy(false); }
  }
  return <section className="space-y-4 rounded-xl bg-[var(--color-surface-hover)] p-4" aria-label="规划学习时间"><h2 className="font-medium">规划学习时间</h2><p className="text-xs text-[var(--color-text-secondary)]">添加可学习时段。系统会避开已有课程和学习安排，并优先安排临近截止的任务。睡眠、休息和不想学习的假期请留在时段之外。</p>
    <label className="flex gap-2 text-xs"><input type="checkbox" checked={skipHolidays} onChange={event => { setSkipHolidays(event.target.checked); setPlan(null); }} />避开2026年法定放假日</label><p className="text-xs text-[var(--color-text-secondary)]"><a href={holidaySource} target="_blank" rel="noreferrer">官方放假与调休安排</a>；学校补课以实际课表为准。2027年及其他年份尚未配置，请按学校通知设置可学习时段。</p>
    <form className="space-y-3" onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); const start = new Date(`${data.get("start")}:00+08:00`), end = new Date(`${data.get("end")}:00+08:00`); if (start >= end) { setError("结束须晚于开始"); return; } setAvailability(previous => [...previous, { start: start.toISOString(), end: end.toISOString() }]); setPlan(null); event.currentTarget.reset(); }}><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs">空闲开始（北京时间）<Input type="datetime-local" name="start" required /></label><label className="text-xs">空闲结束（北京时间）<Input type="datetime-local" name="end" required /></label></div><Button variant="secondary" type="submit" disabled={busy || availability.length >= 120}>添加空闲时段</Button></form>
    <ul className="space-y-2 text-xs">{availability.map((window, index) => <li className="flex items-center justify-between gap-2" key={index}>{new Date(window.start).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })} — {new Date(window.end).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}<Button variant="ghost" size="sm" onClick={() => { setAvailability(previous => previous.filter((_, i) => i !== index)); setPlan(null); }}>移除</Button></li>)}</ul>
    <Button disabled={busy || !availability.length} onClick={() => void request("POST")}>{busy ? "正在处理…" : "预览学习规划"}</Button>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {plan && <div className="space-y-3"><h3 className="text-sm font-medium">建议安排 {plan.blocks.length} 个学习时段</h3><div className="max-h-64 space-y-2 overflow-auto text-xs">{plan.blocks.map((block, index) => <p key={index}>{plan.taskTitles[block.taskId]} · {new Date(block.start).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })} — {new Date(block.end).toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai" })}</p>)}</div>{!plan.feasible && <><p className="text-sm text-destructive">这些任务无法在截止前全部完成：</p><ul className="space-y-1 text-xs">{plan.unscheduled.map(task => <li key={task.taskId}>{plan.taskTitles[task.taskId]} · 还缺 {task.minutes} 分钟</li>)}</ul><label className="flex gap-2 text-xs"><input type="checkbox" checked={acceptIncomplete} onChange={event => setAcceptIncomplete(event.target.checked)} />先保存可以完成的部分</label></>}<Button disabled={busy || !plan.blocks.length || (!plan.feasible && !acceptIncomplete)} onClick={() => void request("PUT")}>确认并加入日历</Button></div>}
  </section>;
}
