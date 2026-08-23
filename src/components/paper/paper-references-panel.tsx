"use client";

import { useState } from "react";
import { BookStack, Check } from "iconoir-react";
import { Button } from "@/components/ui/button";
import { useCreatePaperReference, usePaperReferences } from "@/lib/hooks/use-papers";

interface ReferenceRecord {
  id: string;
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;
  doi: string | null;
  arxivId: string | null;
}

type ReferenceMode = "manual" | "doi" | "bibtex";

export function PaperReferencesPanel({ workspaceId }: { workspaceId: string }) {
  const referencesQuery = usePaperReferences(workspaceId);
  const createReference = useCreatePaperReference(workspaceId);
  const references = (referencesQuery.data ?? []) as ReferenceRecord[];
  const [mode, setMode] = useState<ReferenceMode>("manual");
  const [title, setTitle] = useState("");
  const [authors, setAuthors] = useState("");
  const [year, setYear] = useState("");
  const [venue, setVenue] = useState("");
  const [doi, setDoi] = useState("");
  const [bibtex, setBibtex] = useState("");
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");
    try {
      if (mode === "doi") await createReference.mutateAsync({ action: "doi", doi });
      else if (mode === "bibtex") await createReference.mutateAsync({ action: "bibtex", bibtex });
      else await createReference.mutateAsync({ action: "manual", title, authors: authors.split(",").map((value) => value.trim()).filter(Boolean), year: year ? Number(year) : null, venue: venue || null, doi: doi || null });
      setMessage("已加入论文 References");
      setTitle(""); setAuthors(""); setYear(""); setVenue(""); setDoi(""); setBibtex("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Reference 导入失败");
    }
  }

  return <section className="mt-6 bg-[var(--color-panel)] px-5 py-5"><div className="flex items-start justify-between gap-3"><div><h2 className="text-base font-semibold text-[var(--color-text-primary)]">资料与引用</h2><p className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">Reference 独立于 Research Evidence，正文 Citation 只保存 Reference ID。</p></div><BookStack className="text-[var(--color-accent)]" width={20} height={20} /></div><div className="mt-4 flex gap-1" role="tablist">{(["manual", "doi", "bibtex"] as const).map((item) => <button key={item} type="button" role="tab" aria-selected={mode === item} onClick={() => setMode(item)} className={`rounded-[var(--radius-sm)] px-3 py-1.5 text-xs ${mode === item ? "bg-[var(--color-interaction-selected)] text-[var(--color-text-primary)]" : "text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)]"}`}>{item === "manual" ? "手工添加" : item === "doi" ? "DOI 导入" : "BibTeX 导入"}</button>)}</div><form className="mt-4 grid gap-2" onSubmit={submit}>{mode === "manual" ? <><input required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="标题" className="rounded-[var(--radius-md)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none ring-1 ring-transparent focus:ring-[var(--color-accent)]" /><div className="grid gap-2 sm:grid-cols-2"><input value={authors} onChange={(event) => setAuthors(event.target.value)} placeholder="作者，用逗号分隔" className="rounded-[var(--radius-md)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text-primary)] outline-none ring-1 ring-transparent focus:ring-[var(--color-accent)]" /><input value={year} onChange={(event) => setYear(event.target.value)} inputMode="numeric" placeholder="年份" className="rounded-[var(--radius-md)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text-primary)] outline-none ring-1 ring-transparent focus:ring-[var(--color-accent)]" /></div><div className="grid gap-2 sm:grid-cols-2"><input value={venue} onChange={(event) => setVenue(event.target.value)} placeholder="期刊 / 会议" className="rounded-[var(--radius-md)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text-primary)] outline-none ring-1 ring-transparent focus:ring-[var(--color-accent)]" /><input value={doi} onChange={(event) => setDoi(event.target.value)} placeholder="DOI（可选）" className="rounded-[var(--radius-md)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text-primary)] outline-none ring-1 ring-transparent focus:ring-[var(--color-accent)]" /></div></> : mode === "doi" ? <input required value={doi} onChange={(event) => setDoi(event.target.value)} placeholder="10.xxxx/xxxxx" className="rounded-[var(--radius-md)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none ring-1 ring-transparent focus:ring-[var(--color-accent)]" /> : <textarea required value={bibtex} onChange={(event) => setBibtex(event.target.value)} rows={5} placeholder="粘贴一个或多个 BibTeX 条目" className="resize-y rounded-[var(--radius-md)] bg-[var(--color-bg)] px-3 py-2 text-xs font-mono leading-5 text-[var(--color-text-primary)] outline-none ring-1 ring-transparent focus:ring-[var(--color-accent)]" />}<div className="flex items-center gap-3"><Button type="submit" variant="secondary" size="sm" disabled={createReference.isPending}><Check width={14} height={14} />导入 Reference</Button>{message ? <span className="text-xs text-[var(--color-text-secondary)]">{message}</span> : null}</div></form><div className="mt-5 divide-y divide-[var(--color-separator)]">{references.map((reference) => <div key={reference.id} className="py-3 first:pt-0"><p className="text-sm text-[var(--color-text-primary)]">{reference.title}</p><p className="mt-1 text-xs text-[var(--color-text-secondary)]">{reference.authors.join(", ") || "作者未记录"}{reference.year ? ` · ${reference.year}` : ""}{reference.venue ? ` · ${reference.venue}` : ""}</p>{reference.doi ? <p className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">DOI {reference.doi}</p> : null}</div>)}</div></section>;
}
