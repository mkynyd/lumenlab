"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ResearchComposer, type ResearchComposerOptions } from "@/components/research/research-composer";
import { researchRunStatusLabel } from "@/components/research/status-label";
import { useResearchLaunch } from "@/lib/hooks/use-research-launch";
import { useResearchWorkspaces } from "@/lib/hooks/use-research";
import type { FileAttachment } from "@/lib/chat/router";

function formatWorkspaceUpdatedAt(updatedAt: string): string {
  const time = Date.parse(updatedAt);
  if (!Number.isFinite(time)) return "";
  return new Date(time).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function ResearchDashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const wantsNew = searchParams.get("new") === "1";
  const workspacesQuery = useResearchWorkspaces();
  const launch = useResearchLaunch();
  const workspaces = workspacesQuery.data ?? [];

  async function send(question: string, attachments: FileAttachment[], options: ResearchComposerOptions): Promise<boolean> {
    const result = await launch.launch({ question, attachments, ...options });
    if (!result) return false;
    router.push(`/research/${result.workspaceId}?run=${result.runId}`);
    return true;
  }

  return (
    <main className="h-full overflow-y-auto bg-[var(--color-bg)]">
      <div className="mx-auto max-w-3xl px-5 pb-16 pt-16 sm:px-8 sm:pt-24">
        <header className="text-center">
          <h1 className="text-3xl font-semibold tracking-[-0.025em] text-[var(--color-text-primary)]">深度研究</h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-[var(--color-text-secondary)]">
            把一个问题变成可追溯的研究计划、证据和报告。可附带资料文件，关闭页面后已确认的运行仍会由服务器继续处理。
          </p>
        </header>

        <div className="mt-10">
          <ResearchComposer onSend={send} showDomainSelect autoFocus={wantsNew} disabled={launch.busy} />

          {launch.attachmentStates.length > 0 && launch.phase !== "done" ? (
            <ul aria-label="附件上传状态" className="mt-3 space-y-1 px-2">
              {launch.attachmentStates.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3 text-xs">
                  <span className="min-w-0 truncate text-[var(--color-text-secondary)]">{item.name}</span>
                  <span className={item.status === "failed" ? "shrink-0 text-[var(--color-danger)]" : "shrink-0 text-[var(--color-text-tertiary)]"}>
                    {item.status === "uploading" ? "上传中…" : item.status === "done" ? "完成" : "失败"}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          {launch.phase === "awaiting_attachment_decision" ? (
            <div role="alert" className="mt-4 bg-[var(--color-warning-muted)] px-4 py-3">
              <p className="text-xs leading-5 text-[var(--color-warning)]">所有附件都上传失败。可以不带文件继续研究，或重试上传。</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" variant="primary" size="sm" onClick={() => void launch.continueWithoutFiles().then((result) => { if (result) router.push(`/research/${result.workspaceId}?run=${result.runId}`); })}>
                  不带文件继续
                </Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => void launch.retry().then((result) => { if (result) router.push(`/research/${result.workspaceId}?run=${result.runId}`); })}>
                  重试
                </Button>
              </div>
            </div>
          ) : null}

          {launch.phase === "error" && launch.error ? (
            <div role="alert" className="mt-4 bg-[var(--color-info-muted)] px-4 py-3">
              <p className="text-xs leading-5 text-[var(--color-danger)]">{launch.error}</p>
              <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={() => void launch.retry().then((result) => { if (result) router.push(`/research/${result.workspaceId}?run=${result.runId}`); })}>
                重试
              </Button>
            </div>
          ) : null}

          {launch.notice ? <p role="status" className="mt-3 px-2 text-xs text-[var(--color-text-tertiary)]">{launch.notice}</p> : null}
        </div>

        <section aria-label="研究历史" className="mt-16">
          <h2 className="px-1 text-xs font-medium text-[var(--color-text-tertiary)]">研究历史</h2>
          {workspacesQuery.isPending ? (
            <p className="mt-4 px-1 text-sm text-[var(--color-text-tertiary)]">正在加载研究工作区…</p>
          ) : workspaces.length === 0 ? (
            <p className="mt-4 px-1 text-sm leading-6 text-[var(--color-text-tertiary)]">
              还没有研究记录。在上方输入你的第一个研究问题，确认计划后系统会自动检索、阅读并生成可引用的报告。
            </p>
          ) : (
            <div className="mt-3 grid gap-2 md:grid-cols-2" role="list">
              {workspaces.map((workspace) => (
                <Link key={workspace.id} href={`/research/${workspace.id}`} className="rounded-[var(--radius-lg)] bg-[var(--color-panel)] px-4 py-4 transition-colors hover:bg-[var(--color-surface-hover)]" role="listitem">
                  <h3 className="truncate text-sm font-semibold text-[var(--color-text-primary)]">{workspace.name}</h3>
                  <div className="mt-3 flex items-center gap-3 text-xs text-[var(--color-text-tertiary)]">
                    <span>{workspace._count.runs} 次运行</span>
                    <span>{researchRunStatusLabel(workspace.runs[0]?.status)}</span>
                    <span className="ml-auto">{formatWorkspaceUpdatedAt(workspace.updatedAt)}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
