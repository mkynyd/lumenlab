const RESEARCH_EVIDENCE_ANCHOR_PREFIX = "research-evidence-";

export function researchEvidenceAnchor(evidenceId: string) {
  return `#${RESEARCH_EVIDENCE_ANCHOR_PREFIX}${encodeURIComponent(evidenceId)}`;
}

export function researchEvidenceIdFromAnchor(href: string) {
  const prefix = `#${RESEARCH_EVIDENCE_ANCHOR_PREFIX}`;
  if (!href.startsWith(prefix)) return null;
  const encodedId = href.slice(prefix.length);
  if (!encodedId) return null;
  try {
    return decodeURIComponent(encodedId);
  } catch {
    return null;
  }
}

/**
 * Convert only the stable [E1] markers emitted by the Synthesizer into
 * internal links. Unknown markers remain plain text so a model cannot create
 * a link to evidence that is not part of the immutable report snapshot.
 */
export function linkifyResearchEvidenceMarkers(body: string, evidenceIds: readonly string[]) {
  return body.replace(/\[E(\d+)\](?!\()/g, (marker, indexText: string) => {
    const evidenceId = evidenceIds[Number(indexText) - 1];
    if (!evidenceId) return marker;
    return `[E${indexText}](${researchEvidenceAnchor(evidenceId)})`;
  });
}

export interface CitationMapSourceRef {
  id: string;
  kind: string;
  title: string | null;
  canonicalUrl: string | null;
  doi: string | null;
  provider: string | null;
  /** 作者列表（来自 ResearchSource.metadata.authors），用于引用交互展示。 */
  authors: string[];
  /** 发表年份（来自 ResearchSource.metadata.year）。 */
  year: number | null;
}

export interface CitationMapEntry {
  evidenceId: string;
  sourceSnapshotId: string;
  relation: string;
  locator: Record<string, unknown> | null;
  source: CitationMapSourceRef;
}

/**
 * 构建可审计的 citation map：Evidence → ResearchSourceSnapshot → ResearchSource。
 * locator.kind 区分 web url 与 sciverse chunk（kind:"sciverse" 带 docId/chunkId/offset）。
 * 条目按 (evidenceId) 去重：一个 source 可以被多个 Claim 引用，同一 Claim 内同一
 * Evidence 只保留一条 relation（relation 语义以第一条为准，不伪造）。
 */
export function buildResearchCitationMap(claims: Array<{
  id: string;
  evidenceRelations: Array<{
    evidenceId: string;
    relation: string;
    evidence: {
      locator: unknown;
      sourceSnapshotId: string;
      sourceSnapshot: {
        metadata: unknown;
        source: {
          id: string;
          kind: string;
          title: string | null;
          canonicalUrl: string | null;
          doi: string | null;
          metadata?: unknown;
        };
      };
    };
  }>;
}>): Record<string, CitationMapEntry[]> {
  return Object.fromEntries(claims.map((claim) => {
    const seen = new Set<string>();
    const entries: CitationMapEntry[] = [];
    for (const relation of claim.evidenceRelations) {
      const evidenceId = relation.evidenceId;
      if (seen.has(evidenceId)) continue;
      seen.add(evidenceId);
      const snapshotMetadata = relation.evidence.sourceSnapshot.metadata && typeof relation.evidence.sourceSnapshot.metadata === "object"
        ? relation.evidence.sourceSnapshot.metadata as Record<string, unknown>
        : {};
      const source = relation.evidence.sourceSnapshot.source;
      const sourceMetadata = source.metadata && typeof source.metadata === "object" && !Array.isArray(source.metadata)
        ? source.metadata as Record<string, unknown>
        : {};
      const authors = Array.isArray(sourceMetadata.authors)
        ? sourceMetadata.authors.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).slice(0, 12)
        : [];
      entries.push({
        evidenceId,
        sourceSnapshotId: relation.evidence.sourceSnapshotId,
        relation: relation.relation,
        locator: relation.evidence.locator && typeof relation.evidence.locator === "object" ? relation.evidence.locator as Record<string, unknown> : null,
        source: {
          id: source.id,
          kind: source.kind,
          title: source.title,
          canonicalUrl: source.canonicalUrl,
          doi: source.doi,
          provider: typeof snapshotMetadata.provider === "string" ? snapshotMetadata.provider : null,
          authors,
          year: typeof sourceMetadata.year === "number" && Number.isFinite(sourceMetadata.year) ? sourceMetadata.year : null,
        },
      });
    }
    return [claim.id, entries];
  }));
}

// ─── Bibliography ───────────────────────────────────────────────────────────

export type ResearchEvidenceScope = "full_text_chunk" | "metadata_only" | "web" | "project" | "visual" | "unknown";

export interface ResearchBibliographyEntry {
  /** 用户可见编号，按来源首次出现顺序 1..n。 */
  index: number;
  /** canonical ResearchSource.id（去重键）。 */
  sourceId: string;
  canonicalKey: string;
  kind: string;
  provider: string | null;
  title: string | null;
  authors: string[];
  year: number | null;
  venue: string | null;
  doi: string | null;
  url: string | null;
  /** 该来源支撑的 Evidence（稳定顺序，去重）。 */
  evidenceIds: string[];
  /** 证据读取范围（一个来源可能同时有正文与图表证据）。 */
  evidenceScopes: ResearchEvidenceScope[];
  /** 是否由引用图扩展发现（作为 ResearchSourceRelation 的 target）。 */
  graphDiscovered: boolean;
  /** 该来源参与的关系类型（references / citations / related_work）。 */
  graphRelations: string[];
  /** 是否包含模型从图表得出的视觉观察。 */
  hasVisualEvidence: boolean;
}

export interface BibliographyEvidenceInput {
  id: string;
  evidenceType: string;
  sourceSnapshot: {
    sourceId: string;
    metadata: unknown;
    source: {
      id: string;
      kind: string;
      title: string | null;
      canonicalKey: string;
      canonicalUrl: string | null;
      doi: string | null;
      metadata?: unknown;
    };
  };
}

export interface BibliographyRelationInput {
  sourceId: string;
  targetSourceId: string | null;
  relation: string;
}

function evidenceScopeOf(evidence: BibliographyEvidenceInput): ResearchEvidenceScope {
  if (evidence.evidenceType === "visual_observation") return "visual";
  const metadata = evidence.sourceSnapshot.metadata && typeof evidence.sourceSnapshot.metadata === "object" && !Array.isArray(evidence.sourceSnapshot.metadata)
    ? evidence.sourceSnapshot.metadata as Record<string, unknown>
    : {};
  const scope = metadata.scope && typeof metadata.scope === "object" && !Array.isArray(metadata.scope)
    ? metadata.scope as Record<string, unknown>
    : {};
  const type = typeof scope.type === "string" ? scope.type : "";
  if (type === "metadata_only") return "metadata_only";
  if (type === "bounded_evidence_slices" || type === "bounded_excerpt") return "full_text_chunk";
  if (evidence.sourceSnapshot.source.kind === "web") return "web";
  if (evidence.sourceSnapshot.source.kind === "project_file") return "project";
  return "unknown";
}

function stringArray(value: unknown, maximum: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).slice(0, maximum);
}

/**
 * 去重后的来源清单，按 canonical ResearchSource 归并（同一论文的多个 chunk 只出现
 * 一次）。编号只用于展示；内部 Evidence identity 不变。
 */
export function buildResearchBibliography(input: {
  evidence: BibliographyEvidenceInput[];
  relations?: BibliographyRelationInput[];
}): ResearchBibliographyEntry[] {
  const graphTargets = new Set<string>();
  const graphRelationsBySource = new Map<string, Set<string>>();
  for (const relation of input.relations ?? []) {
    if (!relation.targetSourceId) continue;
    graphTargets.add(relation.targetSourceId);
    const set = graphRelationsBySource.get(relation.targetSourceId) ?? new Set<string>();
    set.add(relation.relation);
    graphRelationsBySource.set(relation.targetSourceId, set);
  }

  const bySource = new Map<string, ResearchBibliographyEntry>();
  for (const evidence of input.evidence) {
    const source = evidence.sourceSnapshot.source;
    const existing = bySource.get(source.id);
    const scope = evidenceScopeOf(evidence);
    if (existing) {
      if (!existing.evidenceIds.includes(evidence.id)) existing.evidenceIds.push(evidence.id);
      if (!existing.evidenceScopes.includes(scope)) existing.evidenceScopes.push(scope);
      if (scope === "visual") existing.hasVisualEvidence = true;
      continue;
    }
    const sourceMetadata = source.metadata && typeof source.metadata === "object" && !Array.isArray(source.metadata)
      ? source.metadata as Record<string, unknown>
      : {};
    const snapshotMetadata = evidence.sourceSnapshot.metadata && typeof evidence.sourceSnapshot.metadata === "object" && !Array.isArray(evidence.sourceSnapshot.metadata)
      ? evidence.sourceSnapshot.metadata as Record<string, unknown>
      : {};
    const venue = typeof sourceMetadata.venue === "string" && sourceMetadata.venue.trim() ? sourceMetadata.venue.trim() : null;
    bySource.set(source.id, {
      index: 0,
      sourceId: source.id,
      canonicalKey: source.canonicalKey,
      kind: source.kind,
      provider: typeof snapshotMetadata.provider === "string" ? snapshotMetadata.provider : null,
      title: source.title,
      authors: stringArray(sourceMetadata.authors, 12),
      year: typeof sourceMetadata.year === "number" && Number.isFinite(sourceMetadata.year) ? sourceMetadata.year : null,
      venue,
      doi: source.doi,
      url: source.canonicalUrl,
      evidenceIds: [evidence.id],
      evidenceScopes: [scope],
      graphDiscovered: graphTargets.has(source.id),
      graphRelations: [...(graphRelationsBySource.get(source.id) ?? new Set<string>())],
      hasVisualEvidence: scope === "visual",
    });
  }
  return [...bySource.values()].map((entry, position) => ({ ...entry, index: position + 1 }));
}

/** 来源类型的中文标签；与前端 Source 列表使用同一套语义。 */
export function researchSourceKindLabel(kind: string, entry?: Pick<ResearchBibliographyEntry, "graphDiscovered">): string {
  const base: Record<string, string> = {
    web: "网页来源",
    academic_paper: "学术论文",
    arxiv: "arXiv 预印本",
    doi: "DOI 文献",
    pmid: "PubMed 文献",
    project_file: "项目资料",
  };
  const label = base[kind] ?? "来源";
  return entry?.graphDiscovered ? `引用关系发现 · ${label}` : label;
}

function formatAuthors(authors: string[]): string | null {
  if (authors.length === 0) return null;
  if (authors.length <= 3) return authors.join(", ");
  return `${authors.slice(0, 3).join(", ")} 等`;
}

/** 渲染「参考来源」小节；只使用已持久化的来源事实，不臆造字段。 */
export function renderResearchBibliographyMarkdown(entries: ResearchBibliographyEntry[]): string {
  if (entries.length === 0) return "";
  const lines = entries.map((entry) => {
    const parts: string[] = [];
    const authors = formatAuthors(entry.authors);
    if (authors) parts.push(authors);
    if (entry.year !== null) parts.push(String(entry.year));
    if (entry.title) parts.push(entry.title);
    else parts.push(entry.canonicalKey);
    if (entry.venue) parts.push(entry.venue);
    const identifiers: string[] = [];
    if (entry.doi) identifiers.push(`DOI: ${entry.doi}`);
    const link = entry.url ?? (entry.doi ? `https://doi.org/${entry.doi}` : null);
    const scopeNotes: string[] = [];
    if (entry.evidenceScopes.includes("metadata_only") && entry.evidenceScopes.length === 1) scopeNotes.push("仅摘要/元数据");
    if (entry.hasVisualEvidence) scopeNotes.push("含图表观察");
    if (entry.graphDiscovered) scopeNotes.push("由引用关系发现");
    const tail = [
      identifiers.join(" · "),
      link ? `[链接](${link})` : "",
      scopeNotes.join(" · "),
    ].filter(Boolean).join(" · ");
    return `${entry.index}. ${parts.join(". ")}${tail ? ` — ${tail}` : ""}`;
  });
  return ["## 参考来源", "", ...lines].join("\n");
}

/**
 * 导出用 Markdown：报告正文 + 去重参考来源。内部 `[E#]` marker 保持不变，
 * 不因为展示编号而改变 Evidence identity。
 */
export function buildResearchReportMarkdown(input: {
  title: string;
  body: string;
  bibliography: ResearchBibliographyEntry[];
}): string {
  const sections = [`# ${input.title}`, "", input.body.trim()];
  const bibliography = renderResearchBibliographyMarkdown(input.bibliography);
  if (bibliography) sections.push("", bibliography);
  return `${sections.join("\n").trim()}\n`;
}
