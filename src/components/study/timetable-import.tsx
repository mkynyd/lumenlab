"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { periodSchema, expandTimetable, type CoursePattern, type CourseEvent } from "@/lib/study/timetable";
type Preview = { patterns: CoursePattern[]; events: CourseEvent[]; warnings: string[] };
export function TimetableImport({ onApplied }: { onApplied: () => Promise<void> }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [periods, setPeriods] = useState<{ number: number; start: string; end: string }[]>([]);
  const [termStart, setTermStart] = useState("");
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [replace, setReplace] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  let expanded: CourseEvent[] = [];
  let timingError = "";
  if (preview?.patterns.length && termStart) {
    try { expanded = expandTimetable({ patterns: preview.patterns, termStart, periods }); }
    catch (cause) { timingError = cause instanceof Error ? cause.message : "请补全节次时间"; }
  }
  const events = [...(preview?.events ?? []), ...expanded];
  async function upload(file: File) {
    setBusy(true); setError(""); setConfirmed(false);
    try {
      const form = new FormData(); form.set("file", file);
      if (rangeStart) form.set("start", `${rangeStart}T00:00:00+08:00`);
      if (rangeEnd) form.set("end", `${rangeEnd}T00:00:00+08:00`);
      const response = await fetch("/api/study/timetable/preview", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "课表识别失败");
      const data = result as Preview;
      setPreview(data);
      let savedPeriods: { number: number; start: string; end: string }[] = [];
      if (data.patterns.length) {
        try {
          const response = await fetch("/api/study/preferences");
          if (response.ok) {
            const { preferences } = await response.json();
            const parsed = periodSchema.array().safeParse(preferences?.periods);
            if (parsed.success) savedPeriods = parsed.data;
            if (preferences?.termStart) setTermStart(new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(preferences.termStart)));
          }
        } catch { /* Unavailable preferences leave explicit blank fields. */ }
      }
      setPeriods([...new Set(data.patterns.flatMap(pattern => pattern.periods))].sort((a, b) => a - b).map(number => savedPeriods.find(period => period.number === number) ?? ({ number, start: "", end: "" })));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "课表识别失败"); }
    finally { setBusy(false); }
  }
  async function apply() {
    if (!preview || timingError || !events.length || !confirmed) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/study/timetable/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...preview, warnings: undefined, termStart, periods, replace, confirmed }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "保存课表失败");
      setPreview(null); await onApplied();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存课表失败"); }
    finally { setBusy(false); }
  }
  return <section className="space-y-4 rounded-xl bg-[var(--color-surface-hover)] p-4" aria-label="导入课表">
    <h2 className="font-medium">导入课表</h2>
    <p className="text-xs text-[var(--color-text-secondary)]">支持图片、Excel、ICS和PDF。先检查课程，再确认学期与学校节次时间。节次会保存，并在下次导入时回填供你核对。</p>
    <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs">ICS导入范围起点<Input type="date" value={rangeStart} onChange={event => setRangeStart(event.target.value)} /></label><label className="text-xs">ICS导入范围终点（不含当天）<Input type="date" value={rangeEnd} onChange={event => setRangeEnd(event.target.value)} /></label></div>
    <label className="inline-block cursor-pointer rounded-md bg-[var(--color-accent-muted)] px-3 py-2 text-sm">{busy ? "正在处理课表…" : "选择课表文件"}<input className="sr-only" type="file" accept="image/*,.xlsx,.xls,.ics,.pdf" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }} /></label>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {preview && <div className="space-y-4">
      {preview.warnings.length > 0 && <ul className="space-y-1 text-xs text-destructive">{preview.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
      {preview.patterns.length > 0 && <><label className="block text-xs">第1周星期一日期<Input type="date" value={termStart} onChange={event => { setTermStart(event.target.value); setConfirmed(false); }} /></label><div className="grid gap-2 sm:grid-cols-2">{periods.map((period, index) => <div key={period.number} className="grid grid-cols-[45px_1fr_1fr] items-center gap-2 text-xs"><span>第{period.number}节</span>{(["start", "end"] as const).map(key => <Input key={key} type="time" aria-label={`第${period.number}节${key === "start" ? "开始" : "结束"}`} value={period[key]} onChange={event => { setPeriods(previous => previous.map((value, i) => i === index ? { ...value, [key]: event.target.value } : value)); setConfirmed(false); }} />)}</div>)}</div><div className="max-h-48 space-y-2 overflow-auto text-xs">{preview.patterns.map((pattern, index) => <p key={index}>{pattern.title} · 星期{pattern.weekday} · 第{pattern.weeks.join("、")}周 · 第{pattern.periods.join("、")}节 · {pattern.location}</p>)}</div></>}
      {timingError && <p className="text-xs text-destructive">{timingError}</p>}
      <p className="text-sm font-medium">预览 {events.length} 次课程</p>
      <div className="max-h-64 space-y-2 overflow-auto text-xs">{events.map((event, index) => <p key={index}>{event.title} · {new Date(event.start).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })} — {new Date(event.end).toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit" })} · {event.location}</p>)}</div>
      <label className="flex gap-2 text-xs"><input type="checkbox" checked={replace} onChange={event => setReplace(event.target.checked)} />替换之前导入的课程</label>
      <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />我已检查课程、周次、节次时间与识别提示；以学校实际调课安排为准。</label>
      <div className="flex gap-2"><Button variant="ghost" disabled={busy} onClick={() => setPreview(null)}>取消</Button><Button disabled={busy || !confirmed || !events.length || !!timingError} onClick={() => void apply()}>确认导入</Button></div>
    </div>}
  </section>;
}
