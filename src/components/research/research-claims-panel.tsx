"use client";

import { useState } from "react";
import { Check, EditPencil, Link as LinkIcon, Refresh } from "iconoir-react";
import { Button } from "@/components/ui/button";
import { useReassessResearchClaim, useUpdateResearchClaim, useUpsertClaimEvidenceRelation } from "@/lib/hooks/use-research";

interface ClaimEvidenceRelation {
  evidence: { id: string; statement: string; status: string; sourceSnapshotId: string };
  relation: string;
  confidence?: number | null;
  rationale?: string | null;
}

interface ClaimItem {
  id: string;
  statement: string;
  userEdited: boolean;
  verificationStatus: string;
  quality?: { label?: string; reason?: string } | null;
  evidenceRelations: ClaimEvidenceRelation[];
}

interface EvidenceOption {
  id: string;
  statement: string;
}

const relationLabels = {
  supports: "支持",
  contradicts: "反驳",
  qualifies: "限定",
  context: "背景",
} as const;

export function ResearchClaimsPanel({ runId, workspaceId, claims, evidence }: { runId: string; workspaceId: string; claims: ClaimItem[]; evidence: EvidenceOption[] }) {
  const updateClaim = useUpdateResearchClaim(runId, workspaceId);
  const reassessClaim = useReassessResearchClaim(runId, workspaceId);
  const upsertRelation = useUpsertClaimEvidenceRelation(runId, workspaceId);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [selectedEvidence, setSelectedEvidence] = useState<Record<string, string>>({});
  const [selectedRelation, setSelectedRelation] = useState<Record<string, keyof typeof relationLabels>>({});
  const [error, setError] = useState("");

  async function saveClaim(claimId: string) {
    if (draft.trim().length < 3) return;
    setError("");
    try {
      await updateClaim.mutateAsync({ claimId, statement: draft.trim() });
      setEditingId(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Claim 保存失败");
    }
  }

  async function saveRelation(claimId: string) {
    const evidenceId = selectedEvidence[claimId];
    if (!evidenceId) return;
    setError("");
    try {
      await upsertRelation.mutateAsync({ claimId, evidenceId, relation: selectedRelation[claimId] ?? "supports" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Evidence 关系保存失败");
    }
  }

  async function reassess(claimId: string) {
    setError("");
    try {
      await reassessClaim.mutateAsync(claimId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Claim 重评估启动失败");
    }
  }

  if (claims.length === 0) return null;
  return <section className="mt-5 bg-[var(--color-panel)] px-5 py-5"><div className="flex items-center justify-between gap-3"><div><h2 className="text-base font-semibold text-[var(--color-text-primary)]">Claims 与支持关系</h2><p className="mt-1 text-xs text-[var(--color-text-tertiary)]">Claim 是可被支持、反驳或限定的原子命题；编辑后可启动当前 Run 或 Follow-up Run 的证据重评估。</p></div><span className="text-xs text-[var(--color-text-tertiary)]">{claims.length} 条</span></div><div className="mt-4 space-y-3">{claims.map((claim) => <article key={claim.id} className="rounded-[var(--radius-md)] bg-[var(--color-bg)] px-4 py-3"><div className="flex items-start gap-3"><div className="min-w-0 flex-1">{editingId === claim.id ? <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={3} className="w-full resize-y rounded-[var(--radius-md)] bg-[var(--color-panel)] px-3 py-2 text-sm leading-6 text-[var(--color-text-primary)] outline-none ring-1 ring-transparent focus:ring-[var(--color-accent)]" /> : <p className="text-sm leading-6 text-[var(--color-text-primary)]">{claim.statement}</p>}<div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[var(--color-text-tertiary)]"><span>{claim.quality?.label ?? claim.verificationStatus}</span>{claim.userEdited ? <span>用户编辑</span> : null}<span>{claim.evidenceRelations.length} 条关系</span></div></div>{editingId === claim.id ? <div className="flex shrink-0 gap-1"><Button type="button" variant="ghost" size="sm" onClick={() => saveClaim(claim.id)}><Check width={14} height={14} />保存</Button><Button type="button" variant="ghost" size="sm" onClick={() => setEditingId(null)}>取消</Button></div> : <Button type="button" variant="ghost" size="sm" onClick={() => { setEditingId(claim.id); setDraft(claim.statement); }}><EditPencil width={14} height={14} />编辑</Button>}</div><div className="mt-3 space-y-1">{claim.evidenceRelations.map((relation) => <div key={relation.evidence.id} className="flex items-start gap-2 text-xs leading-5 text-[var(--color-text-secondary)]"><LinkIcon width={13} height={13} className="mt-1 shrink-0 text-[var(--color-accent)]" /><span>{relationLabels[relation.relation as keyof typeof relationLabels] ?? relation.relation}：{relation.evidence.statement}</span></div>)}</div><div className="mt-3 flex flex-wrap gap-2"><select value={selectedEvidence[claim.id] ?? ""} onChange={(event) => setSelectedEvidence((current) => ({ ...current, [claim.id]: event.target.value }))} className="min-w-0 flex-1 rounded-[var(--radius-md)] bg-[var(--color-panel)] px-3 py-2 text-xs text-[var(--color-text-primary)]"><option value="">关联一条 Evidence…</option>{evidence.map((item) => <option key={item.id} value={item.id}>{item.statement.slice(0, 80)}</option>)}</select><select value={selectedRelation[claim.id] ?? "supports"} onChange={(event) => setSelectedRelation((current) => ({ ...current, [claim.id]: event.target.value as keyof typeof relationLabels }))} className="rounded-[var(--radius-md)] bg-[var(--color-panel)] px-3 py-2 text-xs text-[var(--color-text-primary)]">{Object.entries(relationLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><Button type="button" variant="secondary" size="sm" onClick={() => saveRelation(claim.id)} disabled={!selectedEvidence[claim.id] || upsertRelation.isPending}><LinkIcon width={14} height={14} />保存关系</Button><Button type="button" variant="ghost" size="sm" onClick={() => void reassess(claim.id)} disabled={claim.verificationStatus !== "pending" || reassessClaim.isPending}><Refresh width={14} height={14} />重新评估</Button></div></article>)}</div>{error ? <p className="mt-3 text-xs text-[var(--color-danger)]">{error}</p> : null}</section>;
}
