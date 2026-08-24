"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BookStack, Check, CloudUpload, NavArrowDown, NavArrowUp, Play, Plus, Trash } from "iconoir-react";
import { Button } from "@/components/ui/button";
import { fetchJson } from "@/lib/api/client";
import { usePaperWorkspace } from "@/lib/hooks/use-papers";
import { createInsertableBlock, insertDocumentBlock, moveHeadingSubtree, removeDocumentBlock, updateDocumentBlockText, type InsertableBlockKind } from "@/lib/paper/document-editor-operations";
import type { AcademicDocument } from "@/lib/paper/document-schema";
import { PaperReferencesPanel } from "@/components/paper/paper-references-panel";
import { PaperPdfViewer } from "@/components/paper/paper-pdf-viewer";
import { PaperTemplateBindingPanel } from "@/components/paper/paper-template-binding-panel";

interface BlockRecord {
  kind: string;
  id?: string;
  children?: Array<{ kind?: string; text?: string }>;
  title?: string;
  authors?: string[];
  institution?: string;
  degreeType?: string;
  date?: string;
  language?: string;
  keywords?: string[];
  level?: number;
  assetId?: string;
  caption?: string;
  label?: string;
  width?: number;
  alignment?: string;
  placement?: string;
  columns?: string[];
  rows?: string[][];
  latex?: string;
  ordered?: boolean;
  items?: Array<Array<{ kind?: string; text?: string }>>;
  referenceIds?: string[];
  blocks?: BlockRecord[];
}

interface AcademicDocumentRecord {
  schemaVersion: "1";
  title: string;
  blocks: BlockRecord[];
}

interface CompilationRecord {
  id: string;
  status: string;
  pdfUrl?: string | null;
  sourceUrl?: string | null;
  errorLog?: { message?: string; code?: string; nodeId?: string; nodeMap?: Record<string, unknown> } | null;
  syncTex?: { provider?: string; key?: string; format?: string } | null;
  pdfCompilationId?: string | null;
}

function blockText(block: BlockRecord) {
  if (block.kind === "paper_metadata") return block.title ?? "论文元数据";
  return block.children?.map((child) => child.text ?? "").join("") ?? (block.title ?? block.kind);
}

function newBlockId(kind: string) {
  const suffix = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${kind}-${suffix}`;
}

function BlockCommandMenu({ onSelect }: { onSelect: (kind: InsertableBlockKind) => void }) {
  const commands: Array<{ kind: InsertableBlockKind; label: string }> = [
    { kind: "paragraph", label: "正文" },
    { kind: "heading", label: "标题" },
    { kind: "quote", label: "引用" },
    { kind: "equation", label: "公式" },
    { kind: "list", label: "列表" },
    { kind: "table", label: "表格" },
    { kind: "bibliography", label: "参考文献" },
    { kind: "appendix", label: "附录" },
    { kind: "page_break", label: "分页" },
  ];
  return <div className="mt-2 flex flex-wrap items-center gap-1 rounded-[var(--radius-md)] bg-[var(--color-bg)] px-2 py-2 text-xs shadow-sm ring-1 ring-[var(--color-border-light)]"><span className="mr-1 text-[var(--color-text-tertiary)]">插入块</span>{commands.map((command) => <button type="button" key={command.kind} onClick={() => onSelect(command.kind)} className="rounded-[var(--radius-sm)] px-2 py-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]">{command.label}</button>)}</div>;
}

function PaperBlockEditor({ block, index, onTextChange, onUpdate }: { block: BlockRecord; index: number; onTextChange: (index: number, value: string) => void; onUpdate: (index: number, updater: (block: BlockRecord) => BlockRecord) => void }) {
  const text = blockText(block);
  const update = (updater: (current: BlockRecord) => BlockRecord) => onUpdate(index, updater);
  const fieldClass = "w-full rounded-[var(--radius-sm)] bg-[var(--color-bg)] px-2 py-1.5 text-xs text-[var(--color-text-primary)] outline-none ring-1 ring-transparent focus:ring-[var(--color-accent)]";

  if (block.kind === "paper_metadata") {
    return <div className="grid gap-2 rounded-[var(--radius-sm)] bg-[var(--color-bg)] p-3 sm:grid-cols-2"><label className="text-[11px] text-[var(--color-text-tertiary)] sm:col-span-2">论文标题<input value={block.title ?? ""} onChange={(event) => update((current) => ({ ...current, title: event.target.value.trim() || "未命名论文" }))} className={`${fieldClass} mt-1 text-sm`} /></label><label className="text-[11px] text-[var(--color-text-tertiary)] sm:col-span-2">作者（逗号分隔）<input value={(block.authors ?? []).join(", ")} onChange={(event) => update((current) => ({ ...current, authors: event.target.value.split(",").map((item) => item.trim()).filter(Boolean).length > 0 ? event.target.value.split(",").map((item) => item.trim()).filter(Boolean) : ["作者"] }))} className={`${fieldClass} mt-1`} /></label><label className="text-[11px] text-[var(--color-text-tertiary)]">机构<input value={block.institution ?? ""} onChange={(event) => update((current) => ({ ...current, institution: event.target.value || undefined }))} className={`${fieldClass} mt-1`} /></label><label className="text-[11px] text-[var(--color-text-tertiary)]">学位<input value={block.degreeType ?? ""} onChange={(event) => update((current) => ({ ...current, degreeType: event.target.value || undefined }))} className={`${fieldClass} mt-1`} /></label><label className="text-[11px] text-[var(--color-text-tertiary)]">日期<input value={block.date ?? ""} onChange={(event) => update((current) => ({ ...current, date: event.target.value || undefined }))} className={`${fieldClass} mt-1`} /></label></div>;
  }

  if (block.kind === "keywords") {
    return <label className="block rounded-[var(--radius-sm)] bg-[var(--color-bg)] p-3 text-[11px] text-[var(--color-text-tertiary)]">关键词（逗号分隔）<input value={(block.keywords ?? []).join(", ")} onChange={(event) => update((current) => ({ ...current, keywords: event.target.value.split(",").map((item) => item.trim()).filter(Boolean).length > 0 ? event.target.value.split(",").map((item) => item.trim()).filter(Boolean) : ["关键词"] }))} className={`${fieldClass} mt-1`} /></label>;
  }

  if (block.kind === "heading" || block.kind === "paragraph" || block.kind === "abstract" || block.kind === "acknowledgement" || block.kind === "quote") {
    return <textarea value={text} onChange={(event) => onTextChange(index, event.target.value)} rows={block.kind === "heading" ? 1 : Math.max(2, Math.min(8, Math.ceil(text.length / 40)))} aria-label={`编辑第 ${index + 1} 个${block.kind === "heading" ? "标题" : "正文块"}`} className={`w-full resize-y bg-transparent text-[15px] leading-8 text-[var(--color-text-primary)] outline-none ${block.kind === "heading" ? `font-semibold ${block.level === 1 ? "text-xl" : "text-lg"}` : ""}`} />;
  }

  if (block.kind === "equation") {
    return <div className="space-y-2 rounded-[var(--radius-sm)] bg-[var(--color-bg)] p-3"><label className="block text-[11px] text-[var(--color-text-tertiary)]">LaTeX 公式<textarea value={block.latex ?? ""} onChange={(event) => update((current) => ({ ...current, latex: event.target.value }))} rows={2} className={`${fieldClass} mt-1 font-mono`} /></label><label className="block text-[11px] text-[var(--color-text-tertiary)]">标签<input value={block.label ?? ""} onChange={(event) => update((current) => ({ ...current, label: event.target.value || undefined }))} className={`${fieldClass} mt-1`} placeholder="eq:method" /></label></div>;
  }

  if (block.kind === "figure") {
    return <div className="grid gap-2 rounded-[var(--radius-sm)] bg-[var(--color-bg)] p-3 sm:grid-cols-2"><label className="text-[11px] text-[var(--color-text-tertiary)] sm:col-span-2">Object Storage Asset ID<input value={block.assetId ?? ""} onChange={(event) => update((current) => ({ ...current, assetId: event.target.value }))} className={`${fieldClass} mt-1 font-mono`} /></label><label className="text-[11px] text-[var(--color-text-tertiary)] sm:col-span-2">图注<input value={block.caption ?? ""} onChange={(event) => update((current) => ({ ...current, caption: event.target.value }))} className={`${fieldClass} mt-1`} /></label><label className="text-[11px] text-[var(--color-text-tertiary)]">标签<input value={block.label ?? ""} onChange={(event) => update((current) => ({ ...current, label: event.target.value || undefined }))} className={`${fieldClass} mt-1`} placeholder="fig:overview" /></label><label className="text-[11px] text-[var(--color-text-tertiary)]">宽度（0–1）<input type="number" min="0.01" max="1" step="0.01" value={block.width ?? ""} onChange={(event) => update((current) => ({ ...current, width: event.target.value ? Math.min(1, Math.max(0.01, Number(event.target.value))) : undefined }))} className={`${fieldClass} mt-1`} /></label><label className="text-[11px] text-[var(--color-text-tertiary)]">对齐<select value={block.alignment ?? "center"} onChange={(event) => update((current) => ({ ...current, alignment: event.target.value }))} className={`${fieldClass} mt-1`}><option value="left">左</option><option value="center">居中</option><option value="right">右</option></select></label><label className="text-[11px] text-[var(--color-text-tertiary)]">位置<select value={block.placement ?? "float"} onChange={(event) => update((current) => ({ ...current, placement: event.target.value }))} className={`${fieldClass} mt-1`}><option value="here">当前位置</option><option value="top">页顶</option><option value="bottom">页底</option><option value="float">浮动</option></select></label></div>;
  }

  if (block.kind === "table") {
    const columns = block.columns ?? [];
    const rows = block.rows ?? [];
    return <div className="space-y-2 rounded-[var(--radius-sm)] bg-[var(--color-bg)] p-3"><div className="overflow-x-auto"><table className="w-full min-w-[32rem] border-collapse text-xs"><thead><tr>{columns.map((column, columnIndex) => <th key={`column-${columnIndex}`} className="border border-[var(--color-separator)] p-1"><input aria-label={`表格第 ${columnIndex + 1} 列`} value={column} onChange={(event) => update((current) => ({ ...current, columns: (current.columns ?? []).map((item, index) => index === columnIndex ? event.target.value : item) }))} className={fieldClass} /></th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={`row-${rowIndex}`}>{columns.map((_, columnIndex) => <td key={`cell-${rowIndex}-${columnIndex}`} className="border border-[var(--color-separator)] p-1"><input aria-label={`表格第 ${rowIndex + 1} 行第 ${columnIndex + 1} 列`} value={row[columnIndex] ?? ""} onChange={(event) => update((current) => ({ ...current, rows: (current.rows ?? []).map((item, index) => { if (index !== rowIndex) return item; const next = [...item]; while (next.length < (current.columns ?? []).length) next.push(""); next[columnIndex] = event.target.value; return next; }) }))} className={fieldClass} /></td>)}</tr>)}</tbody></table></div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => update((current) => ({ ...current, rows: [...(current.rows ?? []), (current.columns ?? []).map(() => "")] }))} className="rounded-[var(--radius-sm)] px-2 py-1 text-[11px] text-[var(--color-accent)] hover:bg-[var(--color-surface-hover)]">+ 添加表格行</button><label className="flex min-w-48 flex-1 items-center gap-2 text-[11px] text-[var(--color-text-tertiary)]">图注<input value={block.caption ?? ""} onChange={(event) => update((current) => ({ ...current, caption: event.target.value || undefined }))} className={fieldClass} /></label><label className="flex min-w-48 flex-1 items-center gap-2 text-[11px] text-[var(--color-text-tertiary)]">标签<input value={block.label ?? ""} onChange={(event) => update((current) => ({ ...current, label: event.target.value || undefined }))} className={fieldClass} /></label></div></div>;
  }

  if (block.kind === "list") {
    return <div className="space-y-2 rounded-[var(--radius-sm)] bg-[var(--color-bg)] p-3"><div className="text-[11px] text-[var(--color-text-tertiary)]">{block.ordered ? "有序列表" : "无序列表"}</div>{(block.items ?? []).map((item, itemIndex) => <input key={`item-${itemIndex}`} value={item.map((child) => child.text ?? "").join("")} onChange={(event) => update((current) => ({ ...current, items: (current.items ?? []).map((candidate, index) => index === itemIndex ? [{ kind: "text", text: event.target.value }] : candidate) }))} className={fieldClass} aria-label={`列表第 ${itemIndex + 1} 项`} />)}</div>;
  }

  if (block.kind === "bibliography") {
    return <label className="block rounded-[var(--radius-sm)] bg-[var(--color-bg)] p-3 text-[11px] text-[var(--color-text-tertiary)]">Reference ID（逗号分隔；Reference 元数据在右侧面板维护）<input value={(block.referenceIds ?? []).join(", ")} onChange={(event) => update((current) => ({ ...current, referenceIds: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) }))} className={`${fieldClass} mt-1 font-mono`} placeholder="留空表示使用当前 Paper References" /></label>;
  }

  if (block.kind === "appendix") {
    return <div className="space-y-2 rounded-[var(--radius-sm)] bg-[var(--color-bg)] p-3"><label className="block text-[11px] text-[var(--color-text-tertiary)]">附录标题<input value={block.title ?? "附录"} onChange={(event) => update((current) => ({ ...current, title: event.target.value || "附录" }))} className={`${fieldClass} mt-1`} /></label><p className="text-[11px] leading-5 text-[var(--color-text-tertiary)]">附录内部块沿用同一 Document 顺序；可在此块后插入标题、正文、公式或表格。</p></div>;
  }

  if (block.kind === "page_break") return <div className="flex items-center gap-3 py-3 text-[11px] text-[var(--color-text-tertiary)]"><span className="h-px flex-1 bg-[var(--color-separator)]" /><span>分页提示</span><span className="h-px flex-1 bg-[var(--color-separator)]" /></div>;

  if (block.kind === "raw_latex") return <textarea value={block.latex ?? ""} onChange={(event) => update((current) => ({ ...current, latex: event.target.value }))} rows={5} aria-label={`编辑第 ${index + 1} 个 Raw LaTeX 块`} className="w-full resize-y rounded-[var(--radius-sm)] bg-[var(--color-bg)] px-3 py-2 font-mono text-xs leading-5 text-[var(--color-text-secondary)] outline-none ring-1 ring-transparent focus:ring-[var(--color-accent)]" />;
  return <div className="text-sm text-[var(--color-text-tertiary)]">[{block.kind}]</div>;
}

export function PaperWorkspaceView({ workspaceId }: { workspaceId: string }) {
  const workspaceQuery = usePaperWorkspace(workspaceId);
  const workspace = workspaceQuery.data as {
    id: string;
    name: string;
    description?: string | null;
    project?: { id: string; name: string } | null;
    document?: { id: string; currentVersion?: { content: AcademicDocumentRecord; version: number } | null; bindings?: Array<{ templateVariantId: string; lockedVersion: string; templateVariant?: { variantKey?: string; registryEntry?: { university?: string; degreeType?: string | null; year?: string | null } } | null }> } | null;
    materials?: unknown[];
    _count?: { materials: number; references: number; researchLinks: number };
    references: unknown[];
  } | undefined;
  const [draftDocument, setDraftDocument] = useState<AcademicDocumentRecord | null>(null);
  const [saveMessage, setSaveMessage] = useState("");
  const [compileMessage, setCompileMessage] = useState("");
  const [importMessage, setImportMessage] = useState("");
  const [pendingImport, setPendingImport] = useState<{ id: string; lowConfidenceBlocks: Array<{ index: number; reason: string }> } | null>(null);
  const [compilation, setCompilation] = useState<CompilationRecord | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [commandIndex, setCommandIndex] = useState<number | null>(null);
  const [railMode, setRailMode] = useState<"pdf" | "assistant">("pdf");
  const [assistantInstruction, setAssistantInstruction] = useState("");
  const [assistantMessage, setAssistantMessage] = useState("");
  const [assistantPatch, setAssistantPatch] = useState<{ id: string; summary: string; status: string } | null>(null);
  const [assistantPending, setAssistantPending] = useState(false);

  const document = draftDocument ?? workspace?.document?.currentVersion?.content ?? null;

  useEffect(() => {
    const documentId = workspace?.document?.id;
    if (!documentId) return;
    let active = true;
    async function loadCompilation() {
      try {
        const result = await fetchJson<{ compilation: CompilationRecord | null; pdfUrl: string | null; sourceUrl: string | null; pdfCompilationId: string | null; previewSyncTex: CompilationRecord["syncTex"] }>(`/api/papers/documents/${documentId}/compile`);
        if (active) setCompilation(result.compilation ? { ...result.compilation, pdfUrl: result.pdfUrl, sourceUrl: result.sourceUrl, pdfCompilationId: result.pdfCompilationId, syncTex: result.previewSyncTex } : null);
      } catch {
        // The editor remains usable when the optional status poll is unavailable.
      }
    }
    void loadCompilation();
    const timer = window.setInterval(() => void loadCompilation(), 4_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [workspace?.document?.id]);

  useEffect(() => {
    const documentId = workspace?.document?.id;
    if (!documentId || !draftDocument || pendingImport) return;
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        setSaveMessage("正在自动保存…");
        await fetchJson(`/api/papers/workspaces/${workspaceId}/document`, { method: "PUT", body: JSON.stringify({ content: draftDocument }) });
        const result = await fetchJson<{ compilation: { status: string } }>(`/api/papers/documents/${documentId}/compile`, { method: "POST" });
        if (!active) return;
        setDraftDocument(null);
        setSaveMessage("已自动保存为新的 Document Version");
        setCompileMessage(`已自动排队编译 PDF：${result.compilation.status}`);
      } catch (error) {
        if (active) setSaveMessage(error instanceof Error ? error.message : "自动保存失败");
      }
    }, 1_200);
    return () => { active = false; window.clearTimeout(timer); };
  }, [draftDocument, pendingImport, workspace?.document?.id, workspaceId]);

  function updateBlock(index: number, value: string) {
    setDraftDocument((current) => {
      if (!current) return current;
      return updateDocumentBlockText(current as unknown as AcademicDocument, index, value) as unknown as AcademicDocumentRecord;
    });
  }

  function updateBlockRecord(index: number, updater: (block: BlockRecord) => BlockRecord) {
    setDraftDocument((current) => current ? { ...current, blocks: current.blocks.map((block, blockIndex) => blockIndex === index ? updater(block) : block) } : current);
  }

  function insertBlock(index: number, kind: InsertableBlockKind) {
    setDraftDocument((current) => current ? insertDocumentBlock(current as unknown as AcademicDocument, index, createInsertableBlock(kind, newBlockId(kind))) as unknown as AcademicDocumentRecord : current);
    setCommandIndex(null);
  }

  function replaceBlock(index: number, kind: InsertableBlockKind) {
    setDraftDocument((current) => {
      if (!current) return current;
      const document = current as unknown as AcademicDocument;
      const without = removeDocumentBlock(document, index);
      return insertDocumentBlock(without, index, createInsertableBlock(kind, newBlockId(kind))) as unknown as AcademicDocumentRecord;
    });
    setCommandIndex(null);
  }

  function removeBlock(index: number) {
    setDraftDocument((current) => current ? removeDocumentBlock(current as unknown as AcademicDocument, index) as unknown as AcademicDocumentRecord : current);
  }

  function moveHeading(index: number, direction: "up" | "down") {
    setDraftDocument((current) => current ? moveHeadingSubtree(current as unknown as AcademicDocument, index, direction) as unknown as AcademicDocumentRecord : current);
  }

  async function saveDocument() {
    if (!workspace?.document || !document) return;
    await fetchJson(`/api/papers/workspaces/${workspaceId}/document`, { method: "PUT", body: JSON.stringify({ content: document }) });
    setDraftDocument(null);
    setSaveMessage("已保存为新的 Document Version");
  }

  async function compile() {
    if (!workspace?.document) return;
    if (draftDocument) await saveDocument();
    const result = await fetchJson<{ compilation: { status: string }; preview: { nodeMap: Record<string, unknown> } }>(`/api/papers/documents/${workspace.document.id}/compile`, { method: "POST" });
    setCompileMessage(`编译任务已排队：${result.compilation.status}，已生成节点映射`);
  }

  async function importFile(file: File) {
    if (!workspace?.document) return;
    const formData = new FormData();
    formData.set("file", file);
    const result = await fetchJson<{ version: { content: AcademicDocumentRecord }; import: { id: string; status: string; importReport?: { warnings?: string[]; lowConfidenceBlocks?: Array<{ index: number; reason: string }>; aiClassification?: { suggestions?: Array<{ index: number; kind: string; confidence: number; reason: string }> } } } }>(`/api/papers/documents/${workspace.document.id}/imports`, { method: "POST", body: formData });
    setDraftDocument(result.version.content);
    const suggestions = result.import.importReport?.aiClassification?.suggestions ?? [];
    const lowConfidenceBlocks = (result.import.importReport?.lowConfidenceBlocks ?? []).map((item) => {
      const suggestion = suggestions.find((candidate) => candidate.index === item.index);
      return suggestion ? { ...item, reason: `${item.reason}；AI 建议：${suggestion.kind}（${Math.round(suggestion.confidence * 100)}%）— ${suggestion.reason}` } : item;
    });
    setPendingImport(result.import.status === "awaiting_confirmation" ? { id: result.import.id, lowConfidenceBlocks } : null);
    setImportMessage(result.import.importReport?.warnings?.[0] ?? "已导入为新的 Document Draft，请检查低置信度结构后再编译");
  }

  async function insertImage(file: File) {
    if (!workspace) return;
    const formData = new FormData();
    formData.set("file", file);
    try {
      setSaveMessage("正在上传图片…");
      const result = await fetchJson<{ asset: { id: string; originalName: string } }>(`/api/papers/workspaces/${workspaceId}/assets`, { method: "POST", body: formData });
      setDraftDocument((current) => current ? { ...current, blocks: [...current.blocks, { kind: "figure", id: newBlockId("figure"), assetId: result.asset.id, caption: result.asset.originalName, alignment: "center", placement: "float" }] } : current);
      setSaveMessage("图片已加入 Document，停顿后自动保存并编译");
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "图片上传失败");
    }
  }

  async function confirmImport() {
    if (!pendingImport || !draftDocument) return;
    await fetchJson(`/api/papers/imports/${pendingImport.id}`, { method: "PATCH", body: JSON.stringify({ content: draftDocument }) });
    setPendingImport(null);
    setDraftDocument(null);
    await workspaceQuery.refetch();
    setImportMessage("结构已确认，当前 Document Version 可以继续排版和编译");
  }

  async function requestAssistantPatch() {
    if (!workspace?.document || !assistantInstruction.trim()) return;
    if (draftDocument) {
      setAssistantMessage("请先保存当前 Document Version，再生成 AI 修改建议。");
      return;
    }
    setAssistantPending(true);
    setAssistantMessage("");
    try {
      const result = await fetchJson<{ patch: { id: string; summary: string; status: string } }>(`/api/papers/documents/${workspace.document.id}/assistant`, { method: "POST", body: JSON.stringify({ instruction: assistantInstruction.trim() }) });
      setAssistantPatch(result.patch);
      setAssistantInstruction("");
      setAssistantMessage("已生成待审核 Document Patch，正文尚未改变。");
    } catch (error) {
      setAssistantMessage(error instanceof Error ? error.message : "AI 修改建议生成失败");
    } finally {
      setAssistantPending(false);
    }
  }

  async function decideAssistantPatch(decision: "accept" | "reject") {
    if (!workspace?.document || !assistantPatch) return;
    setAssistantPending(true);
    try {
      await fetchJson(`/api/papers/documents/${workspace.document.id}/patches/${assistantPatch.id}`, { method: "POST", body: JSON.stringify({ decision }) });
      setAssistantPatch(null);
      setAssistantMessage(decision === "accept" ? "已接受 Patch，并创建新的 Document Version。" : "已拒绝 Patch，正文未改变。");
      if (decision === "accept") {
        setDraftDocument(null);
        await workspaceQuery.refetch();
      }
    } catch (error) {
      setAssistantMessage(error instanceof Error ? error.message : "Document Patch 处理失败");
    } finally {
      setAssistantPending(false);
    }
  }

  if (workspaceQuery.isPending || !workspace) return <main className="flex h-full items-center justify-center text-sm text-[var(--color-text-tertiary)]">正在加载论文工作区…</main>;
  if (!workspace.document || !document) return <main className="flex h-full items-center justify-center text-sm text-[var(--color-text-tertiary)]">论文文档版本尚未准备好。</main>;
  const paperDocument = workspace.document;

  return (
    <main className="h-full overflow-y-auto bg-[var(--color-bg)]"><div className="mx-auto max-w-7xl px-5 py-6 sm:px-8 sm:py-8">
      <Link href="/papers" className="inline-flex items-center gap-1 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"><ArrowLeft width={14} height={14} />我的论文</Link>
      <div className="mt-5 flex items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">{workspace.name}</h1><p className="mt-1 text-sm text-[var(--color-text-secondary)]">Writing · Document Version {paperDocument.currentVersion?.version ?? 1}</p></div><BookStack className="text-[var(--color-accent)]" width={26} height={26} strokeWidth={1.5} /></div>
      <nav aria-label="论文工作区" className="mt-6 flex flex-wrap gap-1 border-b border-[var(--color-separator)] pb-2 text-xs">
        {[{ id: "overview", label: "概览" }, { id: "writing", label: "写作" }, { id: "materials", label: "资料与引用" }, { id: "typesetting", label: "排版设置" }].map((item) => <a key={item.id} href={`#${item.id}`} className="rounded-[var(--radius-sm)] px-3 py-2 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]">{item.label}</a>)}
      </nav>
      <div className="mt-6 flex flex-wrap items-center gap-2"><Button type="button" variant="primary" size="sm" onClick={saveDocument}><Check width={16} height={16} />保存版本</Button><Button type="button" variant="secondary" size="sm" onClick={compile}><Play width={16} height={16} />排队编译 PDF</Button><label className="inline-flex cursor-pointer items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-panel)] px-3 py-2 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"><CloudUpload width={16} height={16} />导入论文<input type="file" accept=".docx,.md,.markdown,.txt,.tex" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); event.currentTarget.value = ""; }} /></label>{saveMessage ? <span className="text-xs text-[var(--color-text-secondary)]">{saveMessage}</span> : null}{compileMessage ? <span className="text-xs text-[var(--color-text-secondary)]">{compileMessage}</span> : null}{importMessage ? <span className="text-xs text-[var(--color-text-secondary)]">{importMessage}</span> : null}</div>
      <section id="overview" className="mt-6 grid gap-3 sm:grid-cols-3">
        <div className="bg-[var(--color-panel)] px-4 py-4"><p className="text-[11px] text-[var(--color-text-tertiary)]">工作区</p><p className="mt-2 text-sm text-[var(--color-text-primary)]">{workspace.project?.name ?? "独立论文"}</p><p className="mt-1 text-xs text-[var(--color-text-secondary)]">{workspace.description || "长期保存 Document、引用、研究材料和模板绑定。"}</p></div>
        <div className="bg-[var(--color-panel)] px-4 py-4"><p className="text-[11px] text-[var(--color-text-tertiary)]">资料与引用</p><p className="mt-2 text-sm text-[var(--color-text-primary)]">{workspace._count?.materials ?? workspace.materials?.length ?? 0} 条研究资料</p><p className="mt-1 text-xs text-[var(--color-text-secondary)]">{workspace._count?.references ?? 0} 条 Paper Reference</p></div>
        <div className="bg-[var(--color-panel)] px-4 py-4"><p className="text-[11px] text-[var(--color-text-tertiary)]">当前版本</p><p className="mt-2 text-sm text-[var(--color-text-primary)]">Document Version {paperDocument.currentVersion?.version ?? 1}</p><p className="mt-1 text-xs text-[var(--color-text-secondary)]">正文真源为结构化 Document，LaTeX 由模板适配器生成。</p></div>
      </section>
      <section id="typesetting" className="scroll-mt-4"><PaperTemplateBindingPanel workspaceId={workspaceId} documentId={paperDocument.id} currentBinding={paperDocument.bindings?.[0]} /></section>
      <section id="materials" className="scroll-mt-4"><PaperReferencesPanel workspaceId={workspaceId} /><div className="mt-4 bg-[var(--color-panel)] px-5 py-4"><div className="flex items-center justify-between gap-3"><div><h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Research 材料链接</h2><p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">从 Research Run 发送的 Source、Claim、Evidence 会保留独立身份，并在此工作区长期可追溯。</p></div><Link href="/research" className="text-xs text-[var(--color-accent)] hover:underline">打开深度研究</Link></div><p className="mt-3 text-xs text-[var(--color-text-tertiary)]">当前已关联 {workspace._count?.materials ?? workspace.materials?.length ?? 0} 条研究资料；选择与发送材料请在对应 Research Run 完成。</p></div></section>
      <section id="writing" className="scroll-mt-4">
      {pendingImport ? <section className="mt-5 bg-[var(--color-info-muted)] px-5 py-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-sm font-semibold text-[var(--color-text-primary)]">确认导入结构</h2><p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">以下块由确定性解析器标为低置信度，请在正文中调整后确认。原始文件、Import Snapshot 和 Draft Version 会继续保留。</p><ul className="mt-2 space-y-1 text-xs text-[var(--color-text-secondary)]">{pendingImport.lowConfidenceBlocks.map((item) => <li key={`${item.index}-${item.reason}`}>第 {item.index + 1} 块：{item.reason}</li>)}</ul></div><Button type="button" variant="primary" size="sm" onClick={() => void confirmImport()}>确认结构</Button></div></section> : null}
      <div className="mt-6 grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)_20rem]">
        <aside className="bg-[var(--color-panel)] px-4 py-4">
          <p className="text-xs font-medium text-[var(--color-text-tertiary)]">Outline</p>
          <div className="mt-3 space-y-2">
            {document.blocks.filter((block) => block.kind === "heading").map((block) => <button type="button" key={block.id} onClick={() => setSelectedNodeId(block.id ?? null)} className={`block w-full truncate text-left text-sm ${selectedNodeId === block.id ? "text-[var(--color-accent)]" : "text-[var(--color-text-secondary)]"}`}>{blockText(block)}</button>)}
          </div>
        </aside>
        <section className="min-w-0 bg-[var(--color-panel)] px-6 py-8 sm:px-10">
          <div className="mx-auto max-w-[74ch] space-y-5">
            {document.blocks.map((block, index) => {
              const text = blockText(block);
              const isSlashCommand = block.kind === "paragraph" && text.trim() === "/";
              return <div key={block.id ?? `${block.kind}-${index}`} className="group relative">
                <div className="relative">
                  <PaperBlockEditor block={block} index={index} onTextChange={updateBlock} onUpdate={updateBlockRecord} />
                  <div className="absolute -left-10 top-0 flex flex-col gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <button type="button" onClick={() => setCommandIndex(index + 1)} aria-label={`在第 ${index + 1} 个块后插入`} className="flex size-6 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"><Plus width={13} height={13} /></button>
                    {block.kind === "heading" ? <><button type="button" onClick={() => moveHeading(index, "up")} aria-label="整节上移" className="flex size-6 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"><NavArrowUp width={13} height={13} /></button><button type="button" onClick={() => moveHeading(index, "down")} aria-label="整节下移" className="flex size-6 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"><NavArrowDown width={13} height={13} /></button></> : null}
                    {block.kind !== "paper_metadata" ? <button type="button" onClick={() => removeBlock(index)} aria-label={`删除第 ${index + 1} 个块`} className="flex size-6 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] hover:bg-[var(--color-danger-muted)] hover:text-[var(--color-danger)]"><Trash width={13} height={13} /></button> : null}
                  </div>
                </div>
                {commandIndex === index + 1 ? <BlockCommandMenu onSelect={(kind) => insertBlock(index + 1, kind)} /> : null}
                {isSlashCommand ? <BlockCommandMenu onSelect={(kind) => replaceBlock(index, kind)} /> : null}
              </div>;
            })}
            <div className="flex flex-wrap items-center gap-2 pt-1"><button type="button" onClick={() => setCommandIndex(document.blocks.length)} className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-1 text-xs text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"><Plus width={13} height={13} />添加块</button><label className="inline-flex cursor-pointer items-center gap-1 rounded-[var(--radius-sm)] px-2 py-1 text-xs text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"><CloudUpload width={13} height={13} />插入图片<input type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void insertImage(file); event.currentTarget.value = ""; }} /></label>{commandIndex === document.blocks.length ? <BlockCommandMenu onSelect={(kind) => insertBlock(document.blocks.length, kind)} /> : null}</div>
          </div>
        </section>
        <aside className="bg-[var(--color-panel)] px-4 py-4">
          <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-1" role="tablist" aria-label="右侧面板"><button type="button" role="tab" aria-selected={railMode === "pdf"} onClick={() => setRailMode("pdf")} className={`rounded-[var(--radius-sm)] px-2 py-1 text-xs ${railMode === "pdf" ? "bg-[var(--color-interaction-selected)] text-[var(--color-text-primary)]" : "text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)]"}`}>PDF</button><button type="button" role="tab" aria-selected={railMode === "assistant"} onClick={() => setRailMode("assistant")} className={`rounded-[var(--radius-sm)] px-2 py-1 text-xs ${railMode === "assistant" ? "bg-[var(--color-interaction-selected)] text-[var(--color-text-primary)]" : "text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)]"}`}>AI Assistant</button></div>{compilation ? <span className="text-[11px] text-[var(--color-text-tertiary)]">{compilation.status}</span> : null}</div>
          {railMode === "pdf" ? <>{compilation?.pdfUrl ? <PaperPdfViewer key={compilation.pdfCompilationId ?? compilation.id} pdfUrl={compilation.pdfUrl} mapUrl={compilation.syncTex && compilation.pdfCompilationId ? `/api/papers/compilations/${compilation.pdfCompilationId}/synctex/map` : undefined} selectedNodeId={selectedNodeId} /> : <div className="mt-4 min-h-64 text-center text-xs leading-5 text-[var(--color-text-tertiary)]">编译成功后，上一版 PDF 会在这里保持可见。<br />AI 修改会先进入 Document Patch。</div>}
            {compilation?.pdfUrl && compilation.status !== "succeeded" ? <p className="mt-3 text-xs text-[var(--color-text-tertiary)]">当前编译{compilation.status === "failed" ? "失败" : "进行中"}，继续显示上一版成功 PDF。</p> : null}
            {compilation?.syncTex && compilation.pdfCompilationId ? <a href={`/api/papers/compilations/${compilation.pdfCompilationId}/synctex`} className="mt-3 inline-flex text-xs text-[var(--color-accent)] hover:underline">下载 SyncTeX 映射</a> : null}
            {compilation?.pdfUrl ? <a href={compilation.pdfUrl} download="paper.pdf" className="ml-3 mt-3 inline-flex text-xs text-[var(--color-accent)] hover:underline">下载 PDF</a> : null}
            {compilation?.sourceUrl ? <a href={compilation.sourceUrl} className="ml-3 mt-3 inline-flex text-xs text-[var(--color-accent)] hover:underline">下载完整 LaTeX Project</a> : null}
            {compilation?.status === "failed" && compilation.errorLog?.message ? <div className="mt-3 space-y-2"><p className="text-xs leading-5 text-[var(--color-danger)]">{compilation.errorLog.code ?? "COMPILE_FAILED"}：{compilation.errorLog.message}</p>{compilation.errorLog.nodeId ? <button type="button" onClick={() => setSelectedNodeId(compilation.errorLog?.nodeId ?? null)} className="text-xs text-[var(--color-accent)] hover:underline">定位到 Document 块</button> : null}</div> : null}
          </> : <div className="mt-4 space-y-4"><div><h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Document Assistant</h3><p className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">AI 只生成待审核 Patch，不会直接覆盖正文，也不会生成 LaTeX 作为真源。</p></div><textarea value={assistantInstruction} onChange={(event) => setAssistantInstruction(event.target.value)} rows={5} placeholder="例如：把当前摘要压缩到 250 字，并保留原有事实与引用" className="w-full resize-y rounded-[var(--radius-md)] bg-[var(--color-bg)] px-3 py-2 text-xs leading-5 text-[var(--color-text-primary)] outline-none ring-1 ring-transparent placeholder:text-[var(--color-text-tertiary)] focus:ring-[var(--color-accent)]" /><Button type="button" variant="secondary" size="sm" onClick={() => void requestAssistantPatch()} disabled={assistantPending || !assistantInstruction.trim()}>生成 Document Patch</Button>{assistantPatch ? <div className="rounded-[var(--radius-md)] bg-[var(--color-bg)] px-3 py-3"><p className="text-xs font-medium text-[var(--color-text-primary)]">{assistantPatch.summary}</p><p className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">待审核 · 正文尚未改变</p><div className="mt-3 flex gap-2"><Button type="button" variant="primary" size="sm" onClick={() => void decideAssistantPatch("accept")} disabled={assistantPending}>接受</Button><Button type="button" variant="ghost" size="sm" onClick={() => void decideAssistantPatch("reject")} disabled={assistantPending}>拒绝</Button></div></div> : null}{assistantMessage ? <p className="text-xs leading-5 text-[var(--color-text-secondary)]">{assistantMessage}</p> : null}</div>}
        </aside>
      </div>
      </section>
    </div></main>
  );
}
