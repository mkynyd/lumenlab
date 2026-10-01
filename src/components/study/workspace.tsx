"use client";
/* eslint-disable @next/next/no-img-element -- Owner-checked selected scan assets. */
import { useCallback, useEffect, useState } from "react";
import { BookOpen, CalendarDays, Plus, Upload, ChevronLeft } from "lucide-react";
import { zhCN } from "react-day-picker/locale";
import Onboarding2 from "@/components/blocks/onboarding-2";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { MarkdownContent } from "@/components/markdown/markdown-content";
import { BankBrowser } from "./bank-browser";
import { StudyPlanning } from "./planning";
import { TimetableImport } from "./timetable-import";
import { chinaHolidays, chinaMakeupWorkdays } from "@/lib/study/holidays";
import { StudyAssistant } from "./assistant";
import { SchoolAdjustments } from "./school-adjustments";
import { TaskExtractor } from "./task-extractor";
import { TextSelector } from "./text-selector";
import { StudyScanner } from "./scanner";
import type { CollectionInput, SelectedQuestion, Solution } from "@/lib/study/contracts";
type Collection = { id: string; name: string; subject: string; exam: string; notebooks: { id: string; name: string; _count?: { items: number } }[] };
type CalendarEvent = { id: string; title: string; kind: string; start: string; end: string };
const chinaDateKey = (value: string) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
const calendarDate = (value: string) => new Date(`${chinaDateKey(value)}T00:00:00`);
type Task = { id: string; title: string; deadline: string; estimatedMinutes: number; completed: boolean };
type Item = { id: string; sourceOrdinal?: string | null; prompt: string; status: string; topics: string[]; error: string | null; assets?: string[]; solution?: Solution | null };
type Job = { id: string; status: string; stage: string; progress: number; error: string | null; attempts: number };
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...init?.headers } });
  const body = await response.json();
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "操作失败，请重试");
  return body;
}
export function StudyWorkspace() {
  const [tab, setTab] = useState<"collections" | "calendar">("collections");
  const [collections, setCollections] = useState<Collection[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [creating, setCreating] = useState(false);
  const [bankOpen, setBankOpen] = useState(false);
  const [notebook, setNotebook] = useState<{ id: string; name: string } | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [detail, setDetail] = useState<Item | null>(null);
  const [editingPrompt, setEditingPrompt] = useState<string | null>(null);
  const [reveal, setReveal] = useState(false);
  const [textSource, setTextSource] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ id: string; pageCount: number; expiresAt: string } | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    const [collectionData, taskData, eventData] = await Promise.all([api<{ collections: Collection[] }>("/api/study/collections"), api<{ tasks: Task[] }>("/api/study/tasks"), api<{ events: CalendarEvent[] }>("/api/study/events")]);
    setCollections(collectionData.collections); setTasks(taskData.tasks); setEvents(eventData.events);
  }, []);
  useEffect(() => {
    let active = true;
    void Promise.all([api<{ collections: Collection[] }>("/api/study/collections"), api<{ tasks: Task[] }>("/api/study/tasks"), api<{ jobs: Job[] }>("/api/study/jobs"), api<{ events: CalendarEvent[] }>("/api/study/events")]).then(([collectionData, taskData, jobData, eventData]) => {
      if (active) { setCollections(collectionData.collections); setTasks(taskData.tasks); setJob(jobData.jobs[0] ?? null); setEvents(eventData.events); }
    }).catch(cause => { if (active) setError(cause.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const reloadItems = useCallback(async () => {
    if (notebook) setItems((await api<{ items: Item[] }>(`/api/study/notebooks/${notebook.id}/items`)).items);
  }, [notebook]);
  useEffect(() => {
    if (!notebook) return;
    let active = true;
    void api<{ items: Item[] }>(`/api/study/notebooks/${notebook.id}/items`).then(result => { if (active) setItems(result.items); }).catch(cause => { if (active) setError(cause.message); });
    return () => { active = false; };
  }, [notebook]);
  useEffect(() => {
    if (!job || ["completed", "failed"].includes(job.status)) return;
    let active = true;
    const timer = setInterval(() => {
      void api<{ job: Job }>(`/api/study/jobs/${job.id}`).then(async result => {
        if (!active) return;
        setJob(result.job);
        if (result.job.status === "completed") { await reloadItems(); await reload(); }
      }).catch(cause => { if (active) setError(cause.message); });
    }, 2500);
    return () => { active = false; clearInterval(timer); };
  }, [job, reloadItems, reload]);
  async function action(operation: () => Promise<void>) {
    setError(""); setBusy(true);
    try { await operation(); } catch (cause) { setError(cause instanceof Error ? cause.message : "操作失败"); }
    finally { setBusy(false); }
  }
  async function create(input: CollectionInput) {
    const result = await api<{ collection: Collection }>("/api/study/collections", { method: "POST", body: JSON.stringify(input) });
    setCreating(false); await reload(); setItems([]); setNotebook(result.collection.notebooks[0]);
  }
  async function submit(questions: SelectedQuestion[], scanMode: "color" | "grayscale") {
    if (!preview || !notebook) return;
    const result = await api<{ jobId: string }>(`/api/study/imports/${preview.id}/selection`, { method: "POST", body: JSON.stringify({ notebookId: notebook.id, questions, scanMode }) });
    setPreview(null); setJob({ id: result.jobId, status: "queued", progress: 0, stage: "等待处理", error: null, attempts: 0 }); await reloadItems();
  }
  if (creating) return <main className="mx-auto w-full max-w-4xl p-4 md:p-8"><Onboarding2 onCreate={create} onCancel={() => setCreating(false)} /></main>;
  if (textSource !== null && notebook) return <main className="mx-auto w-full max-w-6xl p-4"><TextSelector source={textSource} onCancel={() => setTextSource(null)} onSubmit={async questions => { const result = await api<{ jobId: string }>("/api/study/text-selection", { method: "POST", body: JSON.stringify({ notebookId: notebook.id, source: textSource, questions }) }); setTextSource(null); setJob({ id: result.jobId, status: "queued", stage: "等待处理", progress: 0, error: null, attempts: 0 }); await reloadItems(); }} /></main>;
  if (preview) return <main className="mx-auto w-full max-w-7xl p-4 md:p-6"><StudyScanner preview={preview} onSubmit={submit} onCancel={async () => { await api(`/api/study/imports/${preview.id}`, { method: "DELETE" }); setPreview(null); }} /></main>;
  return <main className="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-8">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold">学习</h1><p className="mt-1 text-sm text-[var(--color-text-secondary)]">收录错题，安排课程与截止任务。</p></div><Button onClick={() => setCreating(true)}><Plus />新建题集</Button></header>
    <nav className="flex gap-2" aria-label="学习功能"><Button variant={tab === "collections" ? "secondary" : "ghost"} onClick={() => setTab("collections")}><BookOpen />题集与错题本</Button><Button variant={tab === "calendar" ? "secondary" : "ghost"} onClick={() => setTab("calendar")}><CalendarDays />学习日程</Button></nav>
    <StudyAssistant key={notebook?.id ?? tab} notebookId={notebook?.id} />
    {error && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
    {loading && <p role="status">正在加载…</p>}
    {job && <section className="space-y-2 rounded-xl bg-[var(--color-surface-hover)] p-4" aria-label="错题处理进度"><div className="flex justify-between gap-3"><span role="status" className="text-sm">{job.stage}</span><span className="text-sm">{job.progress}%</span></div><progress className="h-2 w-full accent-blue-500" value={job.progress} max={100} />{job.error && <p className="text-sm text-destructive">{job.error}</p>}{job.status === "failed" && job.attempts < 3 && <Button variant="secondary" disabled={busy} onClick={() => void action(async () => { await api(`/api/study/jobs/${job.id}`, { method: "POST" }); setJob({ ...job, status: "queued", error: null }); })}>重试处理</Button>}</section>}
    {tab === "collections" && <>
      {!notebook && <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{collections.map(collection => <section key={collection.id} className="space-y-3 rounded-xl bg-[var(--color-surface-hover)] p-5"><h2 className="font-semibold">{collection.name}</h2><p className="text-xs text-[var(--color-text-secondary)]">{collection.subject} {collection.exam}</p>{collection.notebooks.map(book => <button type="button" className="flex w-full justify-between rounded-lg bg-[var(--color-surface)] p-3 text-sm" key={book.id} onClick={() => { setNotebook(book); setItems([]); setDetail(null); }}><span>{book.name}</span><span>{book._count?.items ?? 0} 题</span></button>)}<form className="flex gap-2" onSubmit={event => { event.preventDefault(); const form = event.currentTarget; const name = String(new FormData(form).get("name") ?? ""); void action(async () => { await api(`/api/study/collections/${collection.id}/notebooks`, { method: "POST", body: JSON.stringify({ name }) }); form.reset(); await reload(); }); }}><Input name="name" placeholder="新错题本名称" aria-label={`${collection.name}的新错题本名称`} maxLength={100} required /><Button size="sm" variant="ghost" disabled={busy} type="submit">添加</Button></form></section>)}</div>}
      {!notebook && !loading && !collections.length && <section className="rounded-xl bg-[var(--color-surface-hover)] px-6 py-14 text-center"><BookOpen className="mx-auto mb-4" /><h2 className="font-medium">创建你的第一本题集</h2><p className="mt-2 text-sm text-[var(--color-text-secondary)]">先确定学科和考试范围，再上传试卷选择错题。</p><Button className="mt-5" onClick={() => setCreating(true)}>开始创建</Button></section>}
      {notebook && <section className="space-y-4"><div className="flex flex-wrap items-center gap-3"><Button variant="ghost" onClick={() => { setNotebook(null); setDetail(null); }}><ChevronLeft />全部题集</Button><h2 className="font-semibold">{notebook.name}</h2><Button variant="secondary" onClick={() => setBankOpen(true)}>从题库选题</Button><label className="ml-auto"><span className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-[var(--color-accent-muted)] px-3 py-2 text-sm"><Upload size={16} />{busy ? "正在生成预览…" : "上传试卷并选错题"}</span><input className="sr-only" type="file" multiple accept="image/*,.pdf,.doc,.docx,.ppt,.pptx,.odt,.odp,.md,.markdown,.txt" disabled={busy} onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ""; if (!files.length) return; void action(async () => { if (files.some(file => /\.(md|markdown|txt)$/i.test(file.name))) { if (files.length !== 1 || files[0].size > 1024 * 1024) throw new Error("Markdown 请单独上传，文件需在1MB以内"); setTextSource(await files[0].text()); return; } const form = new FormData(); for (const file of files) form.append("file", file); setPreview(await api("/api/study/imports", { method: "POST", body: form })); }); }} /></label></div>
        {bankOpen && <BankBrowser notebookId={notebook.id} onClose={() => setBankOpen(false)} onSelected={async jobId => { setBankOpen(false); if (jobId) setJob({ id: jobId, status: "queued", stage: "等待处理", progress: 0, error: null, attempts: 0 }); await reloadItems(); await reload(); }} />}
        {!items.length && <p className="rounded-xl bg-[var(--color-surface-hover)] p-6 text-sm text-[var(--color-text-secondary)]">还没有错题。上传后只保存你选择的题目，完整试卷会被清除。</p>}
        {items.map((item, index) => <button type="button" key={item.id} className="block w-full space-y-2 rounded-xl bg-[var(--color-surface-hover)] p-5 text-left" onClick={() => void action(async () => { setDetail((await api<{ item: Item }>(`/api/study/items/${item.id}`)).item); setReveal(false); setEditingPrompt(null); })}><div className="flex justify-between text-sm"><span>错题 {items.length - index}{item.sourceOrdinal ? ` · 原题号 ${item.sourceOrdinal}` : ""}</span><span>{item.status === "ready" ? "解析完成" : item.status === "needs_review" ? "需要校对" : "处理中"}</span></div><p className="line-clamp-3 text-sm text-[var(--color-text-secondary)]">{item.prompt || "正在识别题目"}</p>{item.topics.length > 0 && <p className="text-xs text-[var(--color-accent)]">{item.topics.join(" · ")}</p>}</button>)}
      </section>}
      {detail && <section className="space-y-4 rounded-xl bg-[var(--color-surface)] p-5" aria-label="错题详情"><div className="flex justify-between"><h2 className="font-semibold">题目详情</h2><Button variant="ghost" onClick={() => setDetail(null)}>关闭</Button></div><MarkdownContent content={detail.prompt || "题目识别中"} />{detail.assets?.map((src, index) => <img key={src} className="max-h-[420px] max-w-full" src={src} alt={`题目原始选中区域${index + 1}`} />)}{["ready", "needs_review", "failed"].includes(detail.status) && <Button variant="ghost" onClick={() => setEditingPrompt(detail.prompt)}>校对题面并重新解析</Button>}{editingPrompt !== null && <div className="space-y-3"><textarea className="min-h-48 w-full rounded-md bg-[var(--color-surface-hover)] p-3 text-sm" aria-label="校对完整题面" maxLength={200000} value={editingPrompt} onChange={event => setEditingPrompt(event.target.value)} /><p className="text-xs">确认题干、全部选项和共享材料完整后重新解析，已选插图会继续参与核验。</p><Button disabled={busy || !editingPrompt.trim()} onClick={() => void action(async () => { const result = await api<{ jobId: string }>(`/api/study/items/${detail.id}`, { method: "PATCH", body: JSON.stringify({ prompt: editingPrompt, confirmedComplete: true }) }); setDetail(null); setEditingPrompt(null); setJob({ id: result.jobId, status: "queued", stage: "等待处理", progress: 0, error: null, attempts: 0 }); await reloadItems(); })}>确认完整并重新解析</Button></div>}{detail.error && <p className="text-sm text-destructive">{detail.error}</p>}{detail.solution && <><Button variant="secondary" onClick={() => setReveal(!reveal)}>{reveal ? "收起解析" : "查看答案与解析"}</Button>{reveal && <MarkdownContent content={`${detail.solution.answer}\n\n${detail.solution.explanation}`} />}</>}</section>}
    </>}
    {tab === "calendar" && <div className="grid gap-6 lg:grid-cols-[340px_1fr]"><section className="rounded-xl bg-[var(--color-surface-hover)] p-4"><Calendar locale={zhCN} modifiers={{ deadline: tasks.filter(task => !task.completed).map(task => calendarDate(task.deadline)), holiday: chinaHolidays.map(day => new Date(`${day.date}T00:00:00`)), makeup: chinaMakeupWorkdays.map(day => new Date(`${day}T00:00:00`)), course: events.map(event => calendarDate(event.start)) }} mode="single" selected={selectedDate} onSelect={setSelectedDate} modifiersClassNames={{ holiday: "text-[var(--color-accent)]", makeup: "italic", deadline: "bg-[var(--color-accent-muted)] font-semibold", course: "underline decoration-[var(--color-accent)] underline-offset-4" }} /><p className="mt-3 text-xs text-[var(--color-text-secondary)]">高亮：任务截止；下划线：已有日程；彩色：2026法定放假；斜体：调休工作日。学校课程以学校通知为准。</p><div className="mt-4 max-h-72 space-y-3 overflow-auto">{events.filter(event => !selectedDate || chinaDateKey(event.start) === `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, "0")}-${String(selectedDate.getDate()).padStart(2, "0")}`).map(event => <div key={event.id} className="rounded-lg bg-[var(--color-surface)] p-3 text-xs"><p className="font-medium">{event.title}</p><p className="mt-1 text-[var(--color-text-secondary)]">{event.kind === "course" ? "课程" : event.kind === "busy" ? "不可用" : "学习安排"} · {new Date(event.start).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })} — {new Date(event.end).toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit" })}</p><Button size="sm" variant="ghost" disabled={busy} onClick={() => void action(async () => { await api(`/api/study/events/${event.id}`, { method: "DELETE" }); await reload(); })}>移除此日程</Button></div>)}</div></section><section className="space-y-5"><TimetableImport onApplied={reload} /><TaskExtractor onApplied={reload} /><SchoolAdjustments onApplied={reload} /><StudyPlanning onApplied={reload} /><form className="space-y-3 rounded-xl bg-[var(--color-surface-hover)] p-4" onSubmit={event => { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); void action(async () => { await api("/api/study/tasks", { method: "POST", body: JSON.stringify({ title: data.get("title"), deadline: `${data.get("deadline")}:00+08:00`, estimatedMinutes: Number(data.get("minutes")) }) }); form.reset(); await reload(); }); }}><h2 className="font-medium">新增截止任务</h2><Input name="title" aria-label="任务名称" placeholder="例如：完成实验报告" required maxLength={200} /><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs">截止日期与时间（北京时间）<Input type="datetime-local" name="deadline" required /></label><label className="text-xs">预计耗时（分钟）<Input type="number" min={5} max={100000} step={5} defaultValue={60} name="minutes" required /></label></div><Button type="submit" disabled={busy}>添加任务</Button></form><div className="space-y-3"><h2 className="font-semibold">剩余任务 · 按截止时间排序</h2>{tasks.filter(task => !task.completed).map(task => <div key={task.id} className="flex items-center justify-between gap-3 rounded-xl bg-[var(--color-surface-hover)] p-4"><div><p className="text-sm font-medium">{task.title}</p><p className="mt-1 text-xs text-[var(--color-text-secondary)]">{new Date(task.deadline).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })} · 预计{task.estimatedMinutes}分钟</p></div><Button variant="ghost" disabled={busy} onClick={() => void action(async () => { await api(`/api/study/tasks/${task.id}`, { method: "PATCH", body: JSON.stringify({ completed: true }) }); await reload(); })}>完成</Button></div>)}{!tasks.some(task => !task.completed) && <p className="text-sm text-[var(--color-text-secondary)]">没有未完成的截止任务。</p>}</div></section></div>}
  </main>;
}
