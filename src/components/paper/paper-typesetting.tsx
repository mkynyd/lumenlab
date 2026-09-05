"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, BookStack, CheckCircle, LayoutLeft, NavArrowRight, Plus } from "iconoir-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreatePaperWorkspace, usePaperWorkspaces } from "@/lib/hooks/use-papers";
import { useProjects } from "@/lib/hooks/use-projects";

const INDEPENDENT_PROJECT = "__independent_project__";

export function PaperTypesetting() {
  const papersQuery = usePaperWorkspaces();
  const projectsQuery = useProjects();
  const createMutation = useCreatePaperWorkspace();
  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const papers = papersQuery.data ?? [];
  const projects = projectsQuery.data ?? [];

  async function createPaper(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setErrorMessage("请先填写论文标题");
      return;
    }
    setErrorMessage("");
    try {
      const paper = await createMutation.mutateAsync({ name: name.trim(), projectId: projectId || undefined });
      window.location.assign(`/papers/${paper.id}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "创建论文失败，请稍后重试");
    }
  }

  return (
    <main className="h-full overflow-y-auto bg-[var(--color-bg)]">
      <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-10">
        <Link href="/papers" className="inline-flex items-center gap-1 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"><ArrowLeft width={14} height={14} />我的论文</Link>
        <div className="mt-6 flex items-start justify-between gap-5">
          <div className="flex items-start gap-4"><LayoutLeft className="mt-1 text-[var(--color-accent)]" width={28} height={28} strokeWidth={1.5} /><div><h1 className="text-2xl font-semibold tracking-[-0.025em] text-[var(--color-text-primary)]">论文排版</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-text-secondary)]">选择学校模板，像填写卡片一样组织论文，随时查看 LaTeX 排版后的 PDF。</p></div></div>
          <BookStack className="hidden text-[var(--color-accent)] sm:block" width={28} height={28} strokeWidth={1.5} />
        </div>

        <div className="mt-8 grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]">
          <section className="bg-[var(--color-panel)] px-5 py-6 sm:px-6">
            <div className="flex items-start gap-3"><span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent-muted)] text-[var(--color-accent)]"><Plus width={17} height={17} /></span><div><h2 className="text-sm font-semibold text-[var(--color-text-primary)]">创建空白论文</h2><p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">创建后选择排版模板，再按章节填写正文、图表与参考文献。</p></div></div>
            <form onSubmit={createPaper} className="mt-6 space-y-3">
              <label className="block"><span className="mb-1.5 block text-xs font-medium text-[var(--color-text-secondary)]">论文标题</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：面向课程资料的检索增强研究" aria-label="论文标题" className="min-h-10 w-full rounded-[var(--radius-md)] bg-[var(--color-bg)] px-3 text-sm text-[var(--color-text-primary)] outline-none ring-1 ring-[var(--color-border-light)] placeholder:text-[var(--color-text-tertiary)] focus:ring-[var(--color-accent)]" /></label>
              <div><span className="mb-1.5 block text-xs font-medium text-[var(--color-text-secondary)]">关联 Project（可选）</span><Select value={projectId || INDEPENDENT_PROJECT} onValueChange={(value) => setProjectId(value === INDEPENDENT_PROJECT ? "" : value)}><SelectTrigger aria-label="关联 Project" className="min-h-10 w-full bg-[var(--color-bg)] text-sm text-[var(--color-text-primary)]"><SelectValue /></SelectTrigger><SelectContent position="popper" align="start"><SelectGroup><SelectLabel>论文上下文</SelectLabel><SelectItem value={INDEPENDENT_PROJECT}>独立论文工作区</SelectItem>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectGroup></SelectContent></Select></div>
              {errorMessage ? <p className="text-xs text-[var(--color-danger)]">{errorMessage}</p> : null}
              <Button type="submit" variant="primary" size="sm" disabled={createMutation.isPending}><Plus width={16} height={16} />{createMutation.isPending ? "正在创建…" : "创建并开始排版"}</Button>
            </form>
          </section>

          <section className="bg-[var(--color-panel)] px-5 py-6 sm:px-6"><div className="flex items-start gap-3"><span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent-muted)] text-[var(--color-accent)]"><CheckCircle width={17} height={17} /></span><div><h2 className="text-sm font-semibold text-[var(--color-text-primary)]">从内容到论文</h2><p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">卡片可以自由折叠，方便查看完整大纲。排版自动更新，完成后下载 PDF 或完整 LaTeX 工程。</p></div></div><div className="mt-5 space-y-3 text-xs text-[var(--color-text-secondary)]"><p>1. 创建或打开一篇论文</p><p>2. 选择学校排版模板</p><p>3. 填写可折叠卡片，预览并导出 PDF</p></div><Link href="/papers/templates" className="mt-6 inline-flex items-center gap-1 text-xs text-[var(--color-accent)] hover:underline">浏览模板库<NavArrowRight width={14} height={14} /></Link></section>
        </div>

        <section className="mt-8"><div className="flex items-center justify-between gap-3"><div><h2 className="text-sm font-semibold text-[var(--color-text-primary)]">继续排版</h2><p className="mt-1 text-xs text-[var(--color-text-secondary)]">继续上次的写作进度，随时查看历史版本。</p></div><Link href="/papers" className="text-xs text-[var(--color-accent)] hover:underline">查看全部</Link></div>{papersQuery.isPending ? <p className="mt-5 text-sm text-[var(--color-text-tertiary)]">正在加载论文…</p> : papers.length === 0 ? <div className="mt-5 bg-[var(--color-panel)] px-5 py-8 text-center text-xs text-[var(--color-text-tertiary)]">还没有论文，从上面的空白文档开始。</div> : <div className="mt-5 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{papers.slice(0, 6).map((paper) => <Link key={paper.id} href={`/papers/${paper.id}`} className="group bg-[var(--color-panel)] px-4 py-4 hover:bg-[var(--color-surface-hover)]"><div className="flex items-start justify-between gap-3"><h3 className="truncate text-sm font-medium text-[var(--color-text-primary)]">{paper.name}</h3><NavArrowRight className="shrink-0 text-[var(--color-text-tertiary)] transition-transform group-hover:translate-x-0.5" width={15} height={15} /></div><p className="mt-2 text-xs text-[var(--color-text-secondary)]">{paper.project?.name ? `项目：${paper.project.name}` : "独立论文工作区"}</p><p className="mt-4 text-[11px] text-[var(--color-text-tertiary)]">{paper._count.references} 条引用 · {paper._count.materials} 条资料</p></Link>)}</div>}</section>
      </div>
    </main>
  );
}
