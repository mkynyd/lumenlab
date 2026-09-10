"use client";

import { Check, Link as LinkIcon, NavArrowRight, WarningTriangle } from "iconoir-react";
import {
  researchRelationLabel,
  researchVerificationLabel,
  researchVerificationTone,
  type ResearchCitationMap,
  type ResearchCitationMapEntry,
} from "@/lib/research/research-view-model";

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
      id?: string;
      title?: string | null;
      kind?: string;
      canonicalKey: string;
      canonicalUrl?: string | null;
      doi?: string | null;
      arxivId?: string | null;
      pmid?: string | null;
      metadata?: unknown;
    } | null;
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

const verificationToneClass: Record<string, string> = {
  verified: "text-[var(--color-success)]",
  needs_qualification: "text-[var(--color-warning)]",
  conflicted: "text-[var(--color-danger)]",
  unsupported: "text-[var(--color-text-tertiary)]",
};

function sourceLink(source: NonNullable<EvidenceItem["sourceSnapshot"]>["source"] | undefined) {
  if (!source) return null;
  if (source.canonicalUrl) return source.canonicalUrl;
  if (source.doi) return `https://doi.org/${encodeURIComponent(source.doi)}`;
  if (source.arxivId) return `https://arxiv.org/abs/${encodeURIComponent(source.arxivId)}`;
  if (source.pmid) return `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(source.pmid)}/`;
  return null;
}

function locatorLabel(locator: Record<string, unknown> | null) {
  if (!locator) return "";
  return Object.entries(locator)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([key, value]) => `${key}：${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join(" · ");
}

/** 引用卡片：来源标题、作者/年份、DOI/URL、Evidence 摘录、定位与关系类型。 */
export function ResearchCitationCard({
  entry,
  evidence,
  marker,
  className,
}: {
  entry: ResearchCitationMapEntry;
  evidence?: Pick<EvidenceItem, "excerpt" | "evidenceType" | "sourceSnapshot">;
  marker?: string;
  className?: string;
}) {
  const link = sourceLink(evidence?.sourceSnapshot?.source) ?? entry.source.canonicalUrl ?? (entry.source.doi ? `https://doi.org/${entry.source.doi}` : null);
  const authors = (entry.source.authors ?? []).length > 0 ? (entry.source.authors ?? []).join(", ") : null;
  return (
    <div className={className ?? "rounded-[var(--radius-md)] bg-[var(--color-bg)] px-4 py-4"}>
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-xs text-[var(--color-accent)]">{marker ?? "E"}</span>
        <span className="text-[11px] text-[var(--color-text-tertiary)]">{researchRelationLabel(entry.relation)}</span>
      </div>
      <p className="mt-2 text-sm font-medium leading-6 text-[var(--color-text-primary)]">{entry.source.title ?? entry.source.id}</p>
      {authors || entry.source.year !== null ? (
        <p className="mt-1 text-[11px] leading-5 text-[var(--color-text-tertiary)]">{[authors, entry.source.year ?? undefined].filter(Boolean).join(" · ")}</p>
      ) : null}
      {evidence ? <p className="mt-3 text-xs leading-5 text-[var(--color-text-secondary)]">“{evidence.excerpt}”</p> : null}
      <div className="mt-3 space-y-1 text-[11px] leading-5 text-[var(--color-text-tertiary)]">
        {entry.source.doi ? <p>DOI：{entry.source.doi}</p> : null}
        <p>定位：{locatorLabel(entry.locator) || "未提供"}</p>
        <p>类型：{evidence?.evidenceType ?? "unknown"} · 来源种类：{entry.source.kind}{entry.source.provider ? ` · ${entry.source.provider}` : ""}</p>
      </div>
      {link ? <a href={link} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs text-[var(--color-accent)] hover:underline">打开来源 <NavArrowRight width={13} height={13} /></a> : null}
    </div>
  );
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
  citationMap?: ResearchCitationMap;
  evidenceRefs: string[];
  selectedEvidenceId: string | null;
  onSelectEvidence: (evidenceId: string) => void;
}) {
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const markerByEvidenceId = new Map(evidenceRefs.map((id, index) => [id, `E${index + 1}`]));

  // citationMap 是 source of truth：Evidence → Snapshot → Source。缺失时才回退到
  // Claim 的 relation（历史 Run 的兼容路径），不从报告正文重新猜来源。
  const citationIndex = new Map<string, ResearchCitationMapEntry>();
  const mappedEvidenceIds: string[] = [];
  for (const entries of Object.values(citationMap ?? {})) {
    for (const entry of entries) {
      if (!citationIndex.has(entry.evidenceId)) citationIndex.set(entry.evidenceId, entry);
      if (!mappedEvidenceIds.includes(entry.evidenceId)) mappedEvidenceIds.push(entry.evidenceId);
    }
  }
  const relationByEvidenceId = new Map<string, string[]>();
  for (const claim of claims) {
    for (const relation of claim.evidenceRelations) {
      const current = relationByEvidenceId.get(relation.evidence.id) ?? [];
      current.push(`${researchRelationLabel(relation.relation)}：${claim.statement}`);
      relationByEvidenceId.set(relation.evidence.id, current);
    }
  }

  const linkedEvidenceIds = [...new Set([
    ...evidenceRefs,
    ...mappedEvidenceIds,
    ...claims.flatMap((claim) => claim.evidenceRelations.map((relation) => relation.evidence.id)),
  ])].filter((id) => evidenceById.has(id));
  const selectedEvidence = selectedEvidenceId ? evidenceById.get(selectedEvidenceId) : undefined;

  return (
    <aside aria-label="报告来源与证据" className="min-w-0">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">来源与证据</h3>
          <p className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">点击或聚焦正文中的 E 编号，查看本次 Run 实际读取的 Snapshot、摘录与定位。</p>
        </div>
        <LinkIcon width={16} height={16} className="shrink-0 text-[var(--color-accent)]" />
      </div>

      <div className="mt-4 space-y-2">
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">报告断言</p>
        {claims.length > 0 ? claims.map((claim) => {
          const firstEvidenceId = claim.evidenceRelations[0]?.evidence.id;
          const tone = researchVerificationTone(claim.verificationStatus);
          return (
            <button
              key={claim.id}
              type="button"
              onClick={() => { if (firstEvidenceId) onSelectEvidence(firstEvidenceId); }}
              className="flex w-full items-start gap-2 rounded-[var(--radius-md)] bg-[var(--color-bg)] px-3 py-2 text-left hover:bg-[var(--color-surface-hover)]"
            >
              {tone === "positive"
                ? <Check width={14} height={14} className={`mt-0.5 shrink-0 ${verificationToneClass[claim.verificationStatus] ?? ""}`} />
                : <WarningTriangle width={14} height={14} className={`mt-0.5 shrink-0 ${verificationToneClass[claim.verificationStatus] ?? ""}`} />}
              <span className="min-w-0 flex-1 text-xs leading-5 text-[var(--color-text-secondary)]">
                {claim.statement}
                <span className={`mt-1 block text-[11px] ${verificationToneClass[claim.verificationStatus] ?? "text-[var(--color-text-tertiary)]"}`}>
                  {researchVerificationLabel(claim.verificationStatus)} · {claim.evidenceRelations.length} 条关系
                </span>
              </span>
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

      {selectedEvidence ? (() => {
        const entry = citationIndex.get(selectedEvidence.id);
        return entry ? (
          <ResearchCitationCard
            className="mt-5 rounded-[var(--radius-md)] bg-[var(--color-bg)] px-4 py-4"
            entry={entry}
            evidence={selectedEvidence}
            marker={markerByEvidenceId.get(selectedEvidence.id)}
          />
        ) : (
          <div className="mt-5 rounded-[var(--radius-md)] bg-[var(--color-bg)] px-4 py-4">
            <span className="font-mono text-xs text-[var(--color-accent)]">{markerByEvidenceId.get(selectedEvidence.id) ?? "Evidence"}</span>
            <p className="mt-3 text-sm font-medium leading-6 text-[var(--color-text-primary)]">{selectedEvidence.statement}</p>
            <p className="mt-3 text-xs leading-5 text-[var(--color-text-secondary)]">“{selectedEvidence.excerpt}”</p>
            <div className="mt-3 space-y-1 text-[11px] leading-5 text-[var(--color-text-tertiary)]">
              <p>来源：{selectedEvidence.sourceSnapshot?.source?.title ?? selectedEvidence.sourceSnapshot?.source?.canonicalKey ?? "未知来源"}</p>
              <p>定位：{locatorLabel(selectedEvidence.locator) || "未提供"}</p>
              <p>类型：{selectedEvidence.evidenceType}</p>
              {(relationByEvidenceId.get(selectedEvidence.id) ?? []).map((relation) => <p key={relation}>关系：{relation}</p>)}
              {/* citationMap 缺失表示该 Evidence 只作为背景证据；不伪造来源信息。 */}
              <p>该 Evidence 没有进入 citationMap（可能只作为背景证据），未伪造来源信息。</p>
            </div>
            {sourceLink(selectedEvidence.sourceSnapshot?.source) ? <a href={sourceLink(selectedEvidence.sourceSnapshot?.source) ?? undefined} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1 text-xs text-[var(--color-accent)] hover:underline">打开来源 <NavArrowRight width={13} height={13} /></a> : null}
          </div>
        );
      })() : null}
    </aside>
  );
}
