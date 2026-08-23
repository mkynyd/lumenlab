"use client";

import { useState } from "react";
import Link from "next/link";
import { BookStack, LayoutLeft, Plus } from "iconoir-react";
import { Button } from "@/components/ui/button";
import { useCreatePaperWorkspace, usePaperWorkspaces } from "@/lib/hooks/use-papers";

export function PaperDashboard() {
  const papersQuery = usePaperWorkspaces();
  const createMutation = useCreatePaperWorkspace();
  const [name, setName] = useState("");
  const papers = papersQuery.data ?? [];

  async function createPaper(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    const paper = await createMutation.mutateAsync({ name: name.trim() });
    setName("");
    window.location.assign(`/papers/${paper.id}`);
  }

  return (
    <main className="h-full overflow-y-auto bg-[var(--color-bg)]">
      <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 sm:py-10">
        <div className="flex items-start justify-between gap-5"><div><h1 className="text-2xl font-semibold tracking-[-0.025em] text-[var(--color-text-primary)]">论文</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-text-secondary)]">每篇论文拥有一个长期 Document Workspace。可以连接项目或研究资产，也可以完全手动排版，不要求先使用 Deep Research。</p></div><BookStack className="text-[var(--color-accent)]" width={28} height={28} strokeWidth={1.5} /></div>
        <div className="mt-6 flex flex-wrap gap-2"><Link href="/papers/typesetting" className="inline-flex min-h-9 items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-panel)] px-3 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"><LayoutLeft width={16} height={16} />论文排版</Link><Link href="/papers/templates" className="inline-flex min-h-9 items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-panel)] px-3 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]">模板库</Link></div>
        <form onSubmit={createPaper} className="mt-8 flex max-w-2xl gap-2"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="新论文标题" aria-label="新论文标题" className="min-h-10 min-w-0 flex-1 rounded-[var(--radius-md)] bg-[var(--color-panel)] px-3 text-sm text-[var(--color-text-primary)] outline-none ring-1 ring-transparent placeholder:text-[var(--color-text-tertiary)] focus:ring-[var(--color-accent)]" /><Button type="submit" variant="primary" size="sm" disabled={createMutation.isPending}><Plus width={16} height={16} />创建论文</Button></form>
        {papersQuery.isPending ? <p className="mt-8 text-sm text-[var(--color-text-tertiary)]">正在加载论文…</p> : papers.length === 0 ? <div className="py-20 text-center text-sm text-[var(--color-text-tertiary)]">还没有论文。创建后可直接编辑结构化正文并排版。</div> : <div className="mt-8 grid gap-2 md:grid-cols-2">{papers.map((paper) => <Link key={paper.id} href={`/papers/${paper.id}`} className="rounded-[var(--radius-lg)] bg-[var(--color-panel)] px-4 py-4 hover:bg-[var(--color-surface-hover)]"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="truncate text-sm font-semibold text-[var(--color-text-primary)]">{paper.name}</h2><p className="mt-1 text-xs text-[var(--color-text-secondary)]">{paper.project?.name ? `项目：${paper.project.name}` : "独立论文工作区"}</p></div><span className="text-xs text-[var(--color-text-tertiary)]">{paper._count.references} 引用</span></div><p className="mt-5 text-xs text-[var(--color-text-tertiary)]">{paper._count.materials} 条研究资料 · {paper.document?.currentVersionId ? "已有文档版本" : "待创建文档"}</p></Link>)}</div>}
      </div>
    </main>
  );
}
