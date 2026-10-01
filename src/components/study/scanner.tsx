"use client";
/* eslint-disable @next/next/no-img-element -- Expiring authenticated scan pages. */
import { useRef, useState, type PointerEvent } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { regionCoordinates } from "@/lib/study/region-geometry";
import type { SelectedQuestion, QuestionRegion } from "@/lib/study/contracts";
interface ImportPreview { id: string; pageCount: number; expiresAt: string }
export function StudyScanner({ preview, onSubmit, onCancel }: {
  preview: ImportPreview;
  onSubmit: (questions: SelectedQuestion[], scanMode: "color" | "grayscale") => Promise<void>;
  onCancel: () => Promise<void>;
}) {
  const [scanMode, setScanMode] = useState<"color" | "grayscale">("color");
  const [page, setPage] = useState(0);
  const [loadedPage, setLoadedPage] = useState<number | null>(null);
  const [questions, setQuestions] = useState<SelectedQuestion[]>([]);
  const [target, setTarget] = useState<string | null>(null);
  const [role, setRole] = useState<QuestionRegion["role"]>("question");
  const [draft, setDraft] = useState<QuestionRegion | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const origin = useRef<{ x: number; y: number } | null>(null);
  const adjusting = useRef<{ clientId: string; regionIndex: number; resize: boolean; start: { x: number; y: number }; original: QuestionRegion } | null>(null);
  const canvas = useRef<HTMLDivElement>(null);
  function coordinate(event: PointerEvent<HTMLDivElement>) {
    const rect = canvas.current!.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
  }
  function down(event: PointerEvent<HTMLDivElement>) {
    if (busy || loadedPage !== page || event.button !== 0) return;
    if (role !== "question" && !target) { setError("请先选择要绑定的题目"); return; }
    event.currentTarget.setPointerCapture(event.pointerId);
    origin.current = coordinate(event);
    setError("");
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const edit = adjusting.current;
    if (edit) {
      const point = coordinate(event), dx = point.x - edit.start.x, dy = point.y - edit.start.y;
      const r = edit.original;
      const updated = edit.resize ? { ...r, width: Math.max(0.01, Math.min(1 - r.x, r.width + dx)), height: Math.max(0.01, Math.min(1 - r.y, r.height + dy)) } : { ...r, x: Math.max(0, Math.min(1 - r.width, r.x + dx)), y: Math.max(0, Math.min(1 - r.height, r.y + dy)) };
      setQuestions(previous => previous.map(question => question.clientId === edit.clientId ? { ...question, regions: question.regions.map((region, index) => index === edit.regionIndex ? updated : region) } : question));
      return;
    }
    if (!origin.current) return;
    const point = coordinate(event), start = origin.current;
    setDraft({ page, x: Math.min(start.x, point.x), y: Math.min(start.y, point.y), width: Math.abs(point.x - start.x), height: Math.abs(point.y - start.y), role });
  }
  function up(event: PointerEvent<HTMLDivElement>) {
    if (adjusting.current) { adjusting.current = null; return; }
    if (!origin.current) return;
    const point = coordinate(event), start = origin.current;
    origin.current = null;
    const region = { page, x: Math.min(start.x, point.x), y: Math.min(start.y, point.y), width: Math.abs(point.x - start.x), height: Math.abs(point.y - start.y), role };
    setDraft(null);
    if (region.width < 0.01 || region.height < 0.01) return;
    if (role === "question") {
      const id = crypto.randomUUID();
      setQuestions(previous => [...previous, { clientId: id, regions: [region] }]);
      setTarget(id);
    } else {
      setQuestions(previous => previous.map(question => question.clientId === target ? { ...question, regions: [...question.regions, region] } : question));
    }
  }
  async function submit() {
    if (!questions.length) { setError("请至少框选一道错题"); return; }
    setBusy(true); setError("");
    try { await onSubmit(questions, scanMode); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败"); }
    finally { setBusy(false); }
  }
  const selected = questions.find(question => question.clientId === target);
  const regions = questions.flatMap((question, index) => question.regions.map((region, regionIndex) => ({ ...region, clientId: question.clientId, regionIndex, index, selected: question.clientId === target })).filter(region => region.page === page));
  return <section className="space-y-4" aria-label="扫描与框选错题">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">框选错题</h2><p className="mt-1 text-sm text-[var(--color-text-secondary)]">拖动框选完整题目，包含全部选项。跨页插图或长文可绑定到指定题目。</p></div><span className="text-sm">已选 {questions.length} 题</span></header>
    <div className="flex flex-wrap gap-2">{([['question', '新增题目'], ['continuation', '绑定续题'], ['illustration', '绑定插图'], ['material', '绑定长文 / 材料']] as const).map(([value, label]) => <Button key={value} variant={role === value ? "secondary" : "ghost"} disabled={busy} onClick={() => setRole(value)} aria-pressed={role === value}>{label}</Button>)}</div>
    <label className="block text-xs">裁片扫描模式<select value={scanMode} className="ml-2 rounded-md bg-[var(--color-surface-hover)] p-2" onChange={event => setScanMode(event.target.value as "color" | "grayscale")}><option value="color">保留颜色与图中标记</option><option value="grayscale">黑白扫描（适合没有颜色含义的题目）</option></select></label>
    <div className="grid gap-4 lg:grid-cols-[100px_minmax(0,1fr)_240px]">
      <nav aria-label="试卷页码" className="flex gap-2 overflow-auto lg:max-h-[70vh] lg:flex-col">
        {Array.from({ length: preview.pageCount }, (_, index) => <button key={index} type="button" onClick={() => { setPage(index); setDraft(null); origin.current = null; }} className={cn("min-w-20 rounded-lg p-2 text-xs", page === index ? "bg-[var(--color-accent-muted)]" : "bg-[var(--color-surface-hover)]")} aria-current={page === index ? "page" : undefined}><img className="mx-auto max-h-24" src={`/api/study/imports/${preview.id}/pages/${index}`} alt={`第${index + 1}页缩略图`} loading="lazy" draggable={false} />第 {index + 1} 页</button>)}
      </nav>
      <div className="max-h-[70vh] overflow-auto rounded-xl bg-[var(--color-surface-hover)] p-3">
        {loadedPage !== page && <p role="status" className="py-6 text-center text-sm">正在加载第{page + 1}页…</p>}
        <div ref={canvas} className="relative mx-auto w-full max-w-[780px] touch-none select-none" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { origin.current = null; adjusting.current = null; setDraft(null); }}>
          <img className="block w-full" src={`/api/study/imports/${preview.id}/pages/${page}`} alt={`第${page + 1}页，请拖动框选`} onLoad={() => setLoadedPage(page)} onError={() => setError("扫描页加载失败，请检查导入是否过期")} draggable={false} />
          {[...regions, ...(draft ? [{ ...draft, index: questions.length, selected: true, clientId: "", regionIndex: -1 }] : [])].map((region, index) => <div key={index} onPointerDown={event => { if (!region.clientId || busy) return; event.stopPropagation(); canvas.current?.setPointerCapture(event.pointerId); adjusting.current = { clientId: region.clientId, regionIndex: region.regionIndex, resize: false, start: coordinate(event), original: regionCoordinates(region) }; setTarget(region.clientId); }} className={cn("absolute border-2 cursor-move", region.selected ? "border-blue-500 bg-blue-500/10" : "border-blue-300 bg-blue-300/5")} style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }}><span className="bg-blue-500 px-1 text-xs text-white">{region.index + 1} · {region.role === "question" ? "题目" : region.role === "illustration" ? "插图" : region.role === "material" ? "材料" : "续题"}</span>{region.clientId && <div className="absolute -bottom-2 -right-2 size-4 cursor-se-resize rounded-full bg-blue-500" aria-label="拖动调整选框大小" onPointerDown={event => { event.stopPropagation(); canvas.current?.setPointerCapture(event.pointerId); adjusting.current = { clientId: region.clientId, regionIndex: region.regionIndex, resize: true, start: coordinate(event), original: regionCoordinates(region) }; setTarget(region.clientId); }} />}</div>)}
        </div>
      </div>
      <aside className="space-y-3"><h3 className="font-medium">选中的错题</h3><div className="max-h-48 space-y-2 overflow-auto lg:max-h-72">{questions.map((question, index) => <div key={question.clientId} className={cn("flex items-center rounded-lg p-2", target === question.clientId ? "bg-[var(--color-accent-muted)]" : "bg-[var(--color-surface-hover)]")}><button className="flex-1 text-left text-sm" type="button" onClick={() => setTarget(question.clientId)}>第 {index + 1} 题 · {question.regions.length} 个区域</button><Button size="sm" variant="ghost" disabled={busy} onClick={() => { setQuestions(previous => previous.filter(q => q.clientId !== question.clientId)); if (target === question.clientId) setTarget(null); }}>移除</Button></div>)}</div>
        {selected && <div className="space-y-3"><label className="block text-xs">原试卷题号（选填）<input className="mt-1 w-full rounded-md bg-[var(--color-surface-hover)] p-2" aria-label="原试卷题号" maxLength={80} value={selected.sourceOrdinal ?? ""} onChange={event => setQuestions(previous => previous.map(question => question.clientId === target ? { ...question, sourceOrdinal: event.target.value } : question))} /></label><p className="text-xs text-[var(--color-text-secondary)]">拖动选框移动，拖动右下角调整大小；也可填写百分比坐标。</p>{selected.regions.map((region, index) => <div key={index} className="space-y-2 rounded-lg bg-[var(--color-surface-hover)] p-3"><p className="text-xs">第{region.page + 1}页 · {region.role === "question" ? "题目" : region.role === "illustration" ? "插图" : region.role === "material" ? "材料" : "续题"}</p><div className="grid grid-cols-2 gap-2">{([['x', '左'], ['y', '上'], ['width', '宽'], ['height', '高']] as const).map(([key, label]) => <label key={key} className="text-xs">{label}<input aria-label={`区域${index + 1}${label}`} className="mt-1 w-full rounded bg-[var(--color-surface)] p-1" type="number" min={key === "width" || key === "height" ? 1 : 0} max={100} value={Math.round(region[key] * 100)} onChange={event => { const value = Math.max(0, Math.min(1, Number(event.target.value) / 100)); setQuestions(previous => previous.map(question => question.clientId === target ? { ...question, regions: question.regions.map((r, i) => i === index ? { ...r, [key]: value } : r) } : question)); }} /></label>)}</div></div>)}</div>}
      </aside>
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <footer className="flex items-center justify-between"><Button variant="ghost" disabled={busy} onClick={() => { void onCancel().catch(() => setError("取消失败，请重试")); }}>取消并清除原件</Button><Button disabled={busy || !questions.length} onClick={() => void submit()}>{busy ? "正在保存…" : `保存 ${questions.length} 道错题`}</Button></footer>
  </section>;
}
