"use client";

import { useState } from "react";
import Link from "next/link";
import { BrainResearch, Plus } from "iconoir-react";
import { Button } from "@/components/ui/button";
import { useCreateResearchWorkspace, useResearchWorkspaces } from "@/lib/hooks/use-research";

export function ResearchDashboard() {
  const workspacesQuery = useResearchWorkspaces();
  const createMutation = useCreateResearchWorkspace();
  const [name, setName] = useState("");
  const workspaces = workspacesQuery.data ?? [];

  async function createWorkspace(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    const workspace = await createMutation.mutateAsync({ name: name.trim(), budgetProfile: "deep" });
    setName("");
    window.location.assign(`/research/${workspace.id}`);
  }

  return (
    <main className="h-full overflow-y-auto bg-[var(--color-bg)]">
      <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 sm:py-10">
        <div className="mb-8 flex items-start justify-between gap-5">
          <div>
            <h1 className="text-2xl font-semibold tracking-[-0.025em] text-[var(--color-text-primary)]">深度研究</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-text-secondary)]">把一个问题变成可追溯的研究计划、证据和报告。关闭页面后，已确认的运行仍会由服务器继续处理。</p>
          </div>
          <BrainResearch className="mt-1 shrink-0 text-[var(--color-accent)]" width={28} height={28} strokeWidth={1.5} />
        </div>

        <form onSubmit={createWorkspace} className="mb-8 flex max-w-2xl gap-2">
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="新研究工作区名称" aria-label="新研究工作区名称" className="min-h-10 min-w-0 flex-1 rounded-[var(--radius-md)] bg-[var(--color-panel)] px-3 text-sm text-[var(--color-text-primary)] outline-none ring-1 ring-transparent placeholder:text-[var(--color-text-tertiary)] focus:ring-[var(--color-accent)]" />
          <Button type="submit" variant="primary" size="sm" disabled={createMutation.isPending}>
            <Plus width={16} height={16} strokeWidth={2} />
            创建工作区
          </Button>
        </form>

        {workspacesQuery.isPending ? <p className="text-sm text-[var(--color-text-tertiary)]">正在加载研究工作区…</p> : workspaces.length === 0 ? (
          <div className="py-20 text-center text-sm text-[var(--color-text-tertiary)]">还没有研究工作区。先创建一个，再输入研究问题。</div>
        ) : (
          <div className="grid gap-2 md:grid-cols-2" role="list">
            {workspaces.map((workspace) => (
              <Link key={workspace.id} href={`/research/${workspace.id}`} className="group rounded-[var(--radius-lg)] bg-[var(--color-panel)] px-4 py-4 transition-colors hover:bg-[var(--color-surface-hover)]" role="listitem">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-semibold text-[var(--color-text-primary)]">{workspace.name}</h2>
                    <p className="mt-1 line-clamp-1 text-xs text-[var(--color-text-secondary)]">{workspace.project?.name ? `项目：${workspace.project.name}` : "独立研究工作区"}</p>
                  </div>
                  <span className="shrink-0 text-xs text-[var(--color-text-tertiary)]">{workspace.budgetProfile}</span>
                </div>
                <div className="mt-5 flex gap-4 text-xs text-[var(--color-text-tertiary)]">
                  <span>{workspace._count.runs} 次运行</span><span>{workspace._count.sources} 个来源</span><span>{workspace._count.evidence} 条证据</span>
                  <span className="ml-auto">{workspace.runs[0]?.status ?? "待开始"}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
