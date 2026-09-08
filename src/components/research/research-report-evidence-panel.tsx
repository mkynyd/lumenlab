"use client";

import { Check, Link as LinkIcon, NavArrowRight, WarningTriangle } from "iconoir-react";

interface EvidenceItem {
  id: string;
  sourceSnapshotId: string;
  statement: string;
  excerpt: string;
  locator: Record<string, unknown>;
  evidenceType: string;
  status: string;
  tags: string[];
  sourceSnapshot?: {
    id: string;
    retrievedAt: string;
    source?: {
      title?: string | null;
      canonicalKey: string;
      canonicalUrl?: string | null;
      doi?: string | null;
      arxivId?: string | null;
      pmid?: string | null;
    };
  } | null;
}

interface ClaimItem {
  id: string;
  statement: string;
  verificationStatus: string;
  evidenceRelations: Array<{
    relation: string;
    evidence: { id: string; statement: string; status: string; sourceSnapshotId: string };
  }>;
}

export interface ReportCitationMap {
  [claimId: string]: Array<{ evidenceId: string; sourceSnapshotId: string; relation: string }>;
}

const relationLabels: Record<string, string> = {
  supports: "支持",
  contradicts: "反驳",
  qualifies: "限定",
  context: "背景",
};

const verificationLabels: Record<string, string> = {
  verified: "已核验",
  needs_qualification: "需限定",
  unsupported: "证据不足",
  conflicted: "存在争议",
};

function sourceLink(source: NonNullable<EvidenceItem["sourceSnapshot"]>["source"] | undefined) {
  if (!source) return null;
  if (source.canonicalUrl) return source.canonicalUrl;
  if (source.doi) return `https://doi.org/${encodeURIComponent(source.doi)}`;
  if (source.arxivId) return `https://arxiv.org/abs/${encodeURIComponent(source.arxivId)}`;
  if (source.pmid) return `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(source.pmid)}/`;
  return null;
}

function locatorLabel(locator: Record<string, unknown>) {
  return Object.entries(locator)
    .map(([key, value]) => `${key}：${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join(" · ");
}

export function ResearchReportEvidencePanel({
  claims,
  evidence,
  citationMap,
  evidenceRefs,
  selectedEvidenceId,
  onSelectEvidence,
}: {
  claims: ClaimItem[];
  evidence: EvidenceItem[];
  citationMap?: ReportCitationMap;
  evidenceRefs: string[];
  selectedEvidenceId: string | null;
  onSelectEvidence: (evidenceId: string) => void;
}) {
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const markerByEvidenceId = new Map(evidenceRefs.map((id, index) => [id, `E${index + 1}`]));
  const relationByEvidenceId = new Map<string, string[]>();
  for (const claim of claims) {
    for (const relation of claim.evidenceRelations) {
      const current = relationByEvidenceId.get(relation.evidence.id) ?? [];
      current.push(`${relationLabels[relation.relation] ?? relation.relation}：${claim.statement}`);
      relationByEvidenceId.set(relation.evidence.id, current);
    }
  }

  const mappedEvidenceIds = Object.values(citationMap ?? {}).flatMap((relations) => relations.map((relation) => relation.evidenceId));
  const linkedEvidenceIds = [...new Set([
    ...evidenceRefs,
    ...mappedEvidenceIds,
    ...claims.flatMap((claim) => claim.evidenceRelations.map((relation) => relation.evidence.id)),
  ])].filter((id) => evidenceById.has(id));
  const selectedEvidence = selectedEvidenceId ? evidenceById.get(selectedEvidenceId) : undefined;

  return (
    <aside aria-label="报告来源与证据" className="min-w-0 border-l border-[var(--color-border)] pl-0 xl:pl-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">来源与证据</h3>
          <p className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">点击正文中的 E 编号，查看本次 Run 实际读取的 Snapshot、摘录与定位。</p>
        </div>
        <LinkIcon width={16} height={16} className="shrink-0 text-[var(--color-accent)]" />
      </div>

      <div className="mt-4 space-y-2">
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">报告断言</p>
        {claims.length > 0 ? claims.map((claim) => {
          const firstEvidenceId = claim.evidenceRelations[0]?.evidence.id;
          const statusLabel = verificationLabels[claim.verificationStatus] ?? claim.verificationStatus;
          return (
            <button
              key={claim.id}
              type="button"
              onClick={() => { if (firstEvidenceId) onSelectEvidence(firstEvidenceId); }}
              className="flex w-full items-start gap-2 rounded-[var(--radius-md)] bg-[var(--color-bg)] px-3 py-2 text-left hover:bg-[var(--color-surface-hover)]"
            >
              {claim.verificationStatus === "verified" ? <Check width={14} height={14} className="mt-0.5 shrink-0 text-[var(--color-success)]" /> : <WarningTriangle width={14} height={14} className="mt-0.5 shrink-0 text-[var(--color-warning)]" />}
              <span className="min-w-0 flex-1 text-xs leading-5 text-[var(--color-text-secondary)]">{claim.statement}<span className="mt-1 block text-[11px] text-[var(--color-text-tertiary)]">{statusLabel} · {claim.evidenceRelations.length} 条关系</span></span>
              <NavArrowRight width={14} height={14} className="mt-0.5 shrink-0 text-[var(--color-text-tertiary)]" />
            </button>
          );
        }) : <p className="text-xs text-[var(--color-text-tertiary)]">当前快照没有结构化 Claim，以下仍保留可追踪 Evidence。</p>}
      </div>

      <div className="mt-5 space-y-2">
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">引用索引</p>
        {linkedEvidenceIds.length > 0 ? linkedEvidenceIds.map((evidenceId) => {
          const item = evidenceById.get(evidenceId);
          if (!item) return null;
          const isSelected = selectedEvidenceId === evidenceId;
          return <button key={evidenceId} type="button" onClick={() => onSelectEvidence(evidenceId)} aria-pressed={isSelected} className={`flex w-full items-start gap-2 rounded-[var(--radius-md)] px-3 py-2 text-left text-xs ${isSelected ? "bg-[var(--color-interaction-selected)] text-[var(--color-text-primary)]" : "bg-[var(--color-bg)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"}`}><span className="shrink-0 font-mono text-[11px] text-[var(--color-accent)]">{markerByEvidenceId.get(evidenceId) ?? "E?"}</span><span className="min-w-0 flex-1 truncate">{item.statement}</span><NavArrowRight width={14} height={14} className="mt-0.5 shrink-0 text-[var(--color-text-tertiary)]" /></button>;
        }) : <p className="text-xs text-[var(--color-text-tertiary)]">暂无可打开的 Evidence。</p>}
      </div>

      {selectedEvidence ? <div className="mt-5 rounded-[var(--radius-md)] bg-[var(--color-bg)] px-4 py-4">
        <div className="flex items-start justify-between gap-2"><span className="font-mono text-xs text-[var(--color-accent)]">{markerByEvidenceId.get(selectedEvidence.id) ?? "Evidence"}</span><span className="text-[11px] text-[var(--color-text-tertiary)]">{selectedEvidence.status}</span></div>
        <p className="mt-3 text-sm font-medium leading-6 text-[var(--color-text-primary)]">{selectedEvidence.statement}</p>
        <p className="mt-3 text-xs leading-5 text-[var(--color-text-secondary)]">“{selectedEvidence.excerpt}”</p>
        <div className="mt-3 space-y-1 text-[11px] leading-5 text-[var(--color-text-tertiary)]"><p>来源：{selectedEvidence.sourceSnapshot?.source?.title ?? selectedEvidence.sourceSnapshot?.source?.canonicalKey ?? "未知来源"}</p><p>定位：{locatorLabel(selectedEvidence.locator) || "未提供"}</p><p>类型：{selectedEvidence.evidenceType} · Snapshot：{selectedEvidence.sourceSnapshotId.slice(0, 12)}</p>{(relationByEvidenceId.get(selectedEvidence.id) ?? []).map((relation) => <p key={relation}>关系：{relation}</p>)}</div>
        {sourceLink(selectedEvidence.sourceSnapshot?.source) ? <a href={sourceLink(selectedEvidence.sourceSnapshot?.source) ?? undefined} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1 text-xs text-[var(--color-accent)] hover:underline">打开来源 <NavArrowRight width={13} height={13} /></a> : null}
      </div> : null}
    </aside>
  );
}
