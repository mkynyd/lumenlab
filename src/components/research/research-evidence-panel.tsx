"use client";

import { useState } from "react";
import { Check, Refresh } from "iconoir-react";
import { Button } from "@/components/ui/button";
import { useCreateResearchEvidence, useUpdateResearchEvidence } from "@/lib/hooks/use-research";

interface EvidenceItem {
  id: string;
  sourceSnapshotId: string;
  statement: string;
  excerpt: string;
  locator: Record<string, unknown>;
  evidenceType: string;
  status: string;
  tags: string[];
  sourceSnapshot?: { id: string; retrievedAt: string; source?: { title?: string | null; canonicalKey: string; canonicalUrl?: string | null } } | null;
}

const DEFAULT_LOCATOR = '{"page":1}';

export function ResearchEvidencePanel({ runId, workspaceId, evidence }: { runId: string; workspaceId: string; evidence: EvidenceItem[] }) {
  const createEvidence = useCreateResearchEvidence(runId, workspaceId);
  const updateEvidence = useUpdateResearchEvidence(runId, workspaceId);
  const [sourceSnapshotId, setSourceSnapshotId] = useState("");
  const [statement, setStatement] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [locator, setLocator] = useState(DEFAULT_LOCATOR);
  const [tags, setTags] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  function resetForm() {
    setSourceSnapshotId("");
    setStatement("");
    setExcerpt("");
    setLocator(DEFAULT_LOCATOR);
    setTags("");
    setEditingId(null);
    setError("");
  }

  function startEdit(item: EvidenceItem) {
    setEditingId(item.id);
    setSourceSnapshotId(item.sourceSnapshotId);
    setStatement(item.statement);
    setExcerpt(item.excerpt);
    setLocator(JSON.stringify(item.locator));
    setTags(item.tags.join(", "));
    setError("");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    let parsedLocator: Record<string, unknown>;
    try {
      const value: unknown = JSON.parse(locator);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("定位必须是 JSON 对象");
      parsedLocator = value as Record<string, unknown>;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "定位 JSON 无效");
      return;
    }
    const input = { sourceSnapshotId: sourceSnapshotId.trim(), statement: statement.trim(), excerpt: excerpt.trim(), locator: parsedLocator, evidenceType: "paraphrase", tags: tags.split(",") };
    try {
      if (editingId) {
        await updateEvidence.mutateAsync({ evidenceId: editingId, ...input, revisionReason: "用户修订 Evidence" });
      } else {
        await createEvidence.mutateAsync(input);
      }
      resetForm();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Evidence 保存失败");
    }
  }

  return <section className="mt-5 bg-[var(--color-panel)] px-5 py-5"><div className="flex items-center justify-between gap-3"><div><h2 className="text-base font-semibold text-[var(--color-text-primary)]">Evidence</h2><p className="mt-1 text-xs text-[var(--color-text-tertiary)]">原始抽取不可覆盖；用户修订会生成 supersedes 链，可靠性标记只改变状态。</p></div><span className="text-xs text-[var(--color-text-tertiary)]">{evidence.length} 条当前记录</span></div><div className="mt-4 space-y-3">{evidence.map((item) => <article key={item.id} className="rounded-[var(--radius-md)] bg-[var(--color-bg)] px-4 py-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-sm leading-6 text-[var(--color-text-primary)]">{item.statement}</p><p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">“{item.excerpt}”</p></div><span className="shrink-0 text-[11px] text-[var(--color-text-tertiary)]">{item.status}</span></div><div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[var(--color-text-tertiary)]"><span>{item.sourceSnapshot?.source?.title ?? item.sourceSnapshot?.source?.canonicalKey ?? "来源"}</span><span>· {item.evidenceType}</span>{item.tags.map((tag) => <span key={tag}>#{tag}</span>)}<span className="ml-auto font-mono">Snapshot {item.sourceSnapshotId.slice(0, 10)}</span></div><div className="mt-3 flex flex-wrap gap-2"><Button type="button" variant="ghost" size="sm" onClick={() => startEdit(item)}><Refresh width={14} height={14} />修订</Button><Button type="button" variant="ghost" size="sm" onClick={() => updateEvidence.mutate({ evidenceId: item.id, status: "disputed" })} disabled={item.status === "disputed"}>标记争议</Button><Button type="button" variant="ghost" size="sm" onClick={() => updateEvidence.mutate({ evidenceId: item.id, status: "invalidated" })} disabled={item.status === "invalidated"}>标记无效</Button></div></article>)}</div><form className="mt-5 grid gap-2" onSubmit={submit}><p className="text-xs font-medium text-[var(--color-text-secondary)]">{editingId ? "修订当前 Evidence" : "添加人工 Evidence"}</p><input value={sourceSnapshotId} onChange={(event) => setSourceSnapshotId(event.target.value)} required placeholder="Source Snapshot ID" className="rounded-[var(--radius-md)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text-primary)] outline-none ring-1 ring-transparent focus:ring-[var(--color-accent)]" /><input value={statement} onChange={(event) => setStatement(event.target.value)} required minLength={3} placeholder="规范化 statement" className="rounded-[var(--radius-md)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none ring-1 ring-transparent focus:ring-[var(--color-accent)]" /><textarea value={excerpt} onChange={(event) => setExcerpt(event.target.value)} required minLength={3} rows={3} placeholder="短 excerpt" className="resize-y rounded-[var(--radius-md)] bg-[var(--color-bg)] px-3 py-2 text-sm leading-6 text-[var(--color-text-primary)] outline-none ring-1 ring-transparent focus:ring-[var(--color-accent)]" /><div className="grid gap-2 sm:grid-cols-2"><input value={locator} onChange={(event) => setLocator(event.target.value)} required placeholder='Locator JSON，例如 {"page":1}' className="rounded-[var(--radius-md)] bg-[var(--color-bg)] px-3 py-2 text-xs font-mono text-[var(--color-text-primary)] outline-none ring-1 ring-transparent focus:ring-[var(--color-accent)]" /><input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="tags，用逗号分隔" className="rounded-[var(--radius-md)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text-primary)] outline-none ring-1 ring-transparent focus:ring-[var(--color-accent)]" /></div>{error ? <p className="text-xs text-[var(--color-danger)]">{error}</p> : null}<div className="flex gap-2"><Button type="submit" variant="secondary" size="sm" disabled={createEvidence.isPending || updateEvidence.isPending}><Check width={14} height={14} />{editingId ? "保存修订" : "保存 Evidence"}</Button>{editingId ? <Button type="button" variant="ghost" size="sm" onClick={resetForm}>取消</Button> : null}</div></form></section>;
}
