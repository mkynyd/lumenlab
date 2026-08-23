"use client";

import { useState } from "react";
import { Check, Send } from "iconoir-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { fetchJson } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";
import { usePaperWorkspaces } from "@/lib/hooks/use-papers";
import { useTransferResearchMaterials } from "@/lib/hooks/use-research";

interface Candidates {
  sources: Array<{ id: string; title: string | null; canonicalKey: string }>;
  claims: Array<{ id: string; statement: string; verificationStatus: string }>;
  evidence: Array<{ id: string; statement: string; status: string }>;
}

function ToggleList({ title, items, selected, onToggle, label }: { title: string; items: Array<{ id: string; label: string }>; selected: Set<string>; onToggle: (id: string) => void; label: string }) {
  return <div><p className="text-xs font-medium text-[var(--color-text-secondary)]">{title}</p><div className="mt-2 max-h-40 space-y-1 overflow-y-auto">{items.length === 0 ? <p className="text-xs text-[var(--color-text-tertiary)]">暂无可发送材料</p> : items.map((item) => <label key={item.id} className="flex cursor-pointer items-start gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"><input type="checkbox" aria-label={`${label} ${item.label}`} checked={selected.has(item.id)} onChange={() => onToggle(item.id)} className="mt-0.5" /><span className="line-clamp-2">{item.label}</span></label>)}</div></div>;
}

export function ResearchPaperTransferPanel({ runId, workspaceId }: { runId: string; workspaceId: string }) {
  const candidatesQuery = useQuery({ queryKey: queryKeys.research.transfer(runId), queryFn: async () => (await fetchJson<{ candidates: Candidates }>(`/api/research/runs/${runId}/transfer`)).candidates });
  const papersQuery = usePaperWorkspaces();
  const [paperWorkspaceId, setPaperWorkspaceId] = useState("");
  const [sources, setSources] = useState<Set<string>>(new Set());
  const [claims, setClaims] = useState<Set<string>>(new Set());
  const [evidence, setEvidence] = useState<Set<string>>(new Set());
  const transfer = useTransferResearchMaterials(runId, paperWorkspaceId, workspaceId);
  const candidates = candidatesQuery.data;
  const papers = papersQuery.data ?? [];
  function toggle(setter: (next: Set<string>) => void, current: Set<string>, id: string) { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); setter(next); }
  async function submit() {
    if (!paperWorkspaceId) return;
    await transfer.mutateAsync({ sourceIds: [...sources], claimIds: [...claims], evidenceIds: [...evidence] });
    setSources(new Set()); setClaims(new Set()); setEvidence(new Set());
  }
  return <section className="mt-5 bg-[var(--color-panel)] px-5 py-5"><div className="flex items-center justify-between gap-3"><div><h2 className="text-base font-semibold text-[var(--color-text-primary)]">发送到论文</h2><p className="mt-1 text-xs text-[var(--color-text-tertiary)]">Research Source、Claim、Evidence 与 Paper Reference 保持不同职责，发送只建立可追溯材料链接。</p></div><Send className="text-[var(--color-accent)]" width={19} height={19} /></div><div className="mt-4 grid gap-4 sm:grid-cols-3"><ToggleList title="Sources" label="来源" items={(candidates?.sources ?? []).map((item) => ({ id: item.id, label: item.title ?? item.canonicalKey }))} selected={sources} onToggle={(id) => toggle(setSources, sources, id)} /><ToggleList title="Claims" label="命题" items={(candidates?.claims ?? []).map((item) => ({ id: item.id, label: item.statement }))} selected={claims} onToggle={(id) => toggle(setClaims, claims, id)} /><ToggleList title="Evidence" label="证据" items={(candidates?.evidence ?? []).map((item) => ({ id: item.id, label: item.statement }))} selected={evidence} onToggle={(id) => toggle(setEvidence, evidence, id)} /></div><div className="mt-4 flex flex-wrap items-center gap-2"><select value={paperWorkspaceId} onChange={(event) => setPaperWorkspaceId(event.target.value)} aria-label="选择论文工作区" className="min-h-9 min-w-52 rounded-[var(--radius-md)] bg-[var(--color-bg)] px-3 text-sm text-[var(--color-text-primary)]"><option value="">选择论文工作区</option>{papers.map((paper) => <option key={paper.id} value={paper.id}>{paper.name}</option>)}</select><Button type="button" variant="secondary" size="sm" onClick={() => void submit()} disabled={!paperWorkspaceId || (sources.size === 0 && claims.size === 0 && evidence.size === 0) || transfer.isPending}><Check width={14} height={14} />发送选中材料</Button>{transfer.isSuccess ? <span className="text-xs text-[var(--color-text-secondary)]">已建立 PaperResearchMaterial 链接</span> : null}</div></section>;
}
