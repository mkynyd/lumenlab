"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BookStack, Check, CloudUpload, Play } from "iconoir-react";
import { Button } from "@/components/ui/button";
import { fetchJson } from "@/lib/api/client";
import { usePaperWorkspace } from "@/lib/hooks/use-papers";
import { PaperReferencesPanel } from "@/components/paper/paper-references-panel";

interface BlockRecord {
  kind: string;
  id?: string;
  children?: Array<{ kind?: string; text?: string }>;
  title?: string;
  level?: number;
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
  errorLog?: { message?: string; code?: string; nodeMap?: Record<string, unknown> } | null;
  syncTex?: { format?: string } | null;
}

function blockText(block: BlockRecord) {
  if (block.kind === "paper_metadata") return block.title ?? "论文元数据";
  return block.children?.map((child) => child.text ?? "").join("") ?? (block.title ?? block.kind);
}

export function PaperWorkspaceView({ workspaceId }: { workspaceId: string }) {
  const workspaceQuery = usePaperWorkspace(workspaceId);
  const workspace = workspaceQuery.data as {
    id: string;
    name: string;
    document?: { id: string; currentVersion?: { content: AcademicDocumentRecord; version: number } | null } | null;
    references: unknown[];
  } | undefined;
  const [draftDocument, setDraftDocument] = useState<AcademicDocumentRecord | null>(null);
  const [saveMessage, setSaveMessage] = useState("");
  const [compileMessage, setCompileMessage] = useState("");
  const [importMessage, setImportMessage] = useState("");
  const [pendingImport, setPendingImport] = useState<{ id: string; lowConfidenceBlocks: Array<{ index: number; reason: string }> } | null>(null);
  const [compilation, setCompilation] = useState<CompilationRecord | null>(null);

  const document = draftDocument ?? workspace?.document?.currentVersion?.content ?? null;

  useEffect(() => {
    const documentId = workspace?.document?.id;
    if (!documentId) return;
    let active = true;
    async function loadCompilation() {
      try {
        const result = await fetchJson<{ compilation: CompilationRecord | null; pdfUrl: string | null }>(`/api/papers/documents/${documentId}/compile`);
        if (active) setCompilation(result.compilation ? { ...result.compilation, pdfUrl: result.pdfUrl } : null);
      } catch {
        // The editor remains usable when the optional status poll is unavailable.
      }
    }
    void loadCompilation();
    const timer = window.setInterval(() => void loadCompilation(), 4_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [workspace?.document?.id]);

  function updateBlock(index: number, value: string) {
    setDraftDocument((current) => {
      if (!current) return current;
      return { ...current, blocks: current.blocks.map((block, blockIndex) => blockIndex === index ? { ...block, children: [{ kind: "text", text: value }] } : block) };
    });
  }

  async function saveDocument() {
    if (!workspace?.document || !document) return;
    await fetchJson(`/api/papers/workspaces/${workspaceId}/document`, { method: "PUT", body: JSON.stringify({ content: document }) });
    setSaveMessage("已保存为新的 Document Version");
  }

  async function compile() {
    if (!workspace?.document) return;
    const result = await fetchJson<{ compilation: { status: string }; preview: { nodeMap: Record<string, unknown> } }>(`/api/papers/documents/${workspace.document.id}/compile`, { method: "POST" });
    setCompileMessage(`编译任务已排队：${result.compilation.status}，已生成节点映射`);
  }

  async function importFile(file: File) {
    if (!workspace?.document) return;
    const formData = new FormData();
    formData.set("file", file);
    const result = await fetchJson<{ version: { content: AcademicDocumentRecord }; import: { id: string; status: string; importReport?: { warnings?: string[]; lowConfidenceBlocks?: Array<{ index: number; reason: string }> } } }>(`/api/papers/documents/${workspace.document.id}/imports`, { method: "POST", body: formData });
    setDraftDocument(result.version.content);
    setPendingImport(result.import.status === "awaiting_confirmation" ? { id: result.import.id, lowConfidenceBlocks: result.import.importReport?.lowConfidenceBlocks ?? [] } : null);
    setImportMessage(result.import.importReport?.warnings?.[0] ?? "已导入为新的 Document Draft，请检查低置信度结构后再编译");
  }

  async function confirmImport() {
    if (!pendingImport || !draftDocument) return;
    await fetchJson(`/api/papers/imports/${pendingImport.id}`, { method: "PATCH", body: JSON.stringify({ content: draftDocument }) });
    setPendingImport(null);
    setImportMessage("结构已确认，当前 Document Version 可以继续排版和编译");
  }

  if (workspaceQuery.isPending || !workspace) return <main className="flex h-full items-center justify-center text-sm text-[var(--color-text-tertiary)]">正在加载论文工作区…</main>;
  if (!workspace.document || !document) return <main className="flex h-full items-center justify-center text-sm text-[var(--color-text-tertiary)]">论文文档版本尚未准备好。</main>;
  const paperDocument = workspace.document;

  return (
    <main className="h-full overflow-y-auto bg-[var(--color-bg)]"><div className="mx-auto max-w-7xl px-5 py-6 sm:px-8 sm:py-8">
      <Link href="/papers" className="inline-flex items-center gap-1 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"><ArrowLeft width={14} height={14} />我的论文</Link>
      <div className="mt-5 flex items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">{workspace.name}</h1><p className="mt-1 text-sm text-[var(--color-text-secondary)]">Writing · Document Version {paperDocument.currentVersion?.version ?? 1}</p></div><BookStack className="text-[var(--color-accent)]" width={26} height={26} strokeWidth={1.5} /></div>
      <div className="mt-6 flex flex-wrap items-center gap-2"><Button type="button" variant="primary" size="sm" onClick={saveDocument}><Check width={16} height={16} />保存版本</Button><Button type="button" variant="secondary" size="sm" onClick={compile}><Play width={16} height={16} />排队编译 PDF</Button><label className="inline-flex cursor-pointer items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-panel)] px-3 py-2 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"><CloudUpload width={16} height={16} />导入论文<input type="file" accept=".docx,.md,.markdown,.txt,.tex" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); event.currentTarget.value = ""; }} /></label>{saveMessage ? <span className="text-xs text-[var(--color-text-secondary)]">{saveMessage}</span> : null}{compileMessage ? <span className="text-xs text-[var(--color-text-secondary)]">{compileMessage}</span> : null}{importMessage ? <span className="text-xs text-[var(--color-text-secondary)]">{importMessage}</span> : null}</div>
      <PaperReferencesPanel workspaceId={workspaceId} />
      {pendingImport ? <section className="mt-5 bg-[var(--color-info-muted)] px-5 py-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-sm font-semibold text-[var(--color-text-primary)]">确认导入结构</h2><p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">以下块由确定性解析器标为低置信度，请在正文中调整后确认。原始文件、Import Snapshot 和 Draft Version 会继续保留。</p><ul className="mt-2 space-y-1 text-xs text-[var(--color-text-secondary)]">{pendingImport.lowConfidenceBlocks.map((item) => <li key={`${item.index}-${item.reason}`}>第 {item.index + 1} 块：{item.reason}</li>)}</ul></div><Button type="button" variant="primary" size="sm" onClick={() => void confirmImport()}>确认结构</Button></div></section> : null}
      <div className="mt-6 grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)_20rem]"><aside className="bg-[var(--color-panel)] px-4 py-4"><p className="text-xs font-medium text-[var(--color-text-tertiary)]">Outline</p><div className="mt-3 space-y-2">{document.blocks.filter((block) => block.kind === "heading").map((block) => <p key={block.id} className="truncate text-sm text-[var(--color-text-secondary)]">{blockText(block)}</p>)}</div></aside><section className="min-w-0 bg-[var(--color-panel)] px-6 py-8 sm:px-10"><div className="mx-auto max-w-[74ch] space-y-5">{document.blocks.map((block, index) => <div key={block.id ?? `${block.kind}-${index}`} className="group">{block.kind === "heading" ? <textarea value={blockText(block)} onChange={(event) => updateBlock(index, event.target.value)} rows={1} aria-label={`编辑第 ${index + 1} 个标题`} className={`w-full resize-none bg-transparent font-semibold text-[var(--color-text-primary)] outline-none ${block.level === 1 ? "text-xl" : "text-lg"}`} /> : block.kind === "paragraph" || block.kind === "abstract" || block.kind === "acknowledgement" ? <textarea value={blockText(block)} onChange={(event) => updateBlock(index, event.target.value)} rows={Math.max(2, Math.min(8, Math.ceil(blockText(block).length / 40)))} aria-label={`编辑第 ${index + 1} 个正文块`} className="w-full resize-y bg-transparent text-[15px] leading-8 text-[var(--color-text-primary)] outline-none" /> : block.kind === "raw_latex" ? <pre className="overflow-x-auto whitespace-pre-wrap text-xs text-[var(--color-text-tertiary)]">{blockText(block)}</pre> : <div className="text-sm text-[var(--color-text-tertiary)]">[{block.kind}]</div>}</div>)}</div></section><aside className="bg-[var(--color-panel)] px-4 py-4"><div className="flex items-center justify-between gap-2"><p className="text-xs font-medium text-[var(--color-text-tertiary)]">PDF / AI</p>{compilation ? <span className="text-[11px] text-[var(--color-text-tertiary)]">{compilation.status}</span> : null}</div>{compilation?.pdfUrl ? <iframe title="论文 PDF 预览" src={compilation.pdfUrl} className="mt-4 h-[34rem] w-full bg-white" /> : <div className="mt-4 min-h-64 text-center text-xs leading-5 text-[var(--color-text-tertiary)]">编译成功后，上一版 PDF 会在这里保持可见。<br />AI 修改会先进入 Document Patch。</div>}{compilation?.syncTex ? <a href={`/api/papers/compilations/${compilation.id}/synctex`} className="mt-3 inline-flex text-xs text-[var(--color-accent)] hover:underline">下载 SyncTeX 映射</a> : null}{compilation?.status === "failed" && compilation.errorLog?.message ? <p className="mt-3 text-xs leading-5 text-[var(--color-danger)]">{compilation.errorLog.code ?? "COMPILE_FAILED"}：{compilation.errorLog.message}</p> : null}</aside></div>
    </div></main>
  );
}
