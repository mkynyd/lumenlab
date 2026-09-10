/**
 * Deep Research UI 视图模型（纯函数，客户端与服务端测试都可直接引用）。
 *
 * 这里只做「已持久化事实 → 展示语义」的映射：不猜测来源、不重排引用、
 * 不把工程状态混进正文。citationMap / Evidence / ResearchSourceRelation 是
 * source of truth。
 */

export interface ResearchCitationMapSourceRef {
  id: string;
  kind: string;
  title: string | null;
  canonicalUrl: string | null;
  doi: string | null;
  provider: string | null;
  authors?: string[];
  year?: number | null;
}

export interface ResearchCitationMapEntry {
  evidenceId: string;
  sourceSnapshotId: string;
  relation: string;
  locator: Record<string, unknown> | null;
  source: ResearchCitationMapSourceRef;
}

export type ResearchCitationMap = Record<string, ResearchCitationMapEntry[]>;

const RELATION_LABELS: Record<string, string> = {
  supports: "支持",
  contradicts: "反驳",
  qualifies: "限定",
  context: "背景",
  references: "引用",
  citations: "被引用",
  related_work: "相关工作",
};

export function researchRelationLabel(relation: string): string {
  return RELATION_LABELS[relation] ?? relation;
}

const VERIFICATION_LABELS: Record<string, string> = {
  verified: "已核验",
  needs_qualification: "需限定",
  conflicted: "存在争议",
  unsupported: "证据不足",
  pending: "待重新评估",
};

export function researchVerificationLabel(status: string): string {
  return VERIFICATION_LABELS[status] ?? status;
}

/** positive 用成功色、caution 用警示色、neutral 用弱化色。 */
export function researchVerificationTone(status: string): "positive" | "caution" | "neutral" {
  if (status === "verified") return "positive";
  if (status === "needs_qualification" || status === "conflicted") return "caution";
  return "neutral";
}

/** 正向进度（%）只用于展示，不参与任何判定。 */
export function researchQuestionCompletion(status: string): number {
  if (status === "resolved") return 100;
  if (status === "evaluating") return 75;
  if (status === "partially_resolved") return 65;
  if (status === "controversial") return 50;
  if (status === "researching") return 35;
  return 0;
}

export function formatResearchElapsed(startedAt?: string | null, completedAt?: string | null, now = Date.now()): string | null {
  if (!startedAt) return null;
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) return null;
  const end = completedAt ? Date.parse(completedAt) : now;
  const elapsedMs = Math.max(0, (Number.isFinite(end) ? end : now) - start);
  const totalSeconds = Math.floor(elapsedMs / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours} 小时 ${minutes % 60} 分`;
  }
  return `${minutes} 分 ${String(seconds).padStart(2, "0")} 秒`;
}

export interface ResearchProgressSummaryInput {
  questions: Array<{ status: string }>;
  tasks: Array<{ status: string }>;
  sourceCount: number;
  evidenceCount: number;
  claimCount: number;
  graphMetrics?: Record<string, unknown> | null;
  visualMetrics?: Record<string, unknown> | null;
  metrics?: Record<string, unknown> | null;
}

export interface ResearchProgressSummary {
  questionTotal: number;
  questionsResolved: number;
  activeTasks: number;
  sourceCount: number;
  evidenceCount: number;
  claimCount: number;
  citationExpansionSources: number;
  citationExpansionEdges: number;
  visualObservations: number;
  searchCalls: number;
  fetchCalls: number;
  modelCalls: number;
  providerDegradation: boolean;
}

function metricNumber(source: Record<string, unknown> | null | undefined, key: string): number {
  const value = source?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * 有界进度摘要：只暴露计数与阶段，不含隐藏推理、内部 Prompt 或原始工具载荷。
 */
export function buildResearchProgressSummary(input: ResearchProgressSummaryInput): ResearchProgressSummary {
  const graph = input.graphMetrics ?? {};
  const visual = input.visualMetrics ?? {};
  const metrics = input.metrics ?? {};
  return {
    questionTotal: input.questions.length,
    questionsResolved: input.questions.filter((question) => question.status === "resolved").length,
    activeTasks: input.tasks.filter((task) => ["running", "retrying", "pending"].includes(task.status)).length,
    sourceCount: input.sourceCount,
    evidenceCount: input.evidenceCount,
    claimCount: input.claimCount,
    citationExpansionSources: metricNumber(graph, "sourcesFetched"),
    citationExpansionEdges: metricNumber(graph, "edgesDiscovered"),
    visualObservations: metricNumber(visual, "observationsPersisted"),
    searchCalls: metricNumber(metrics, "searchCalls"),
    fetchCalls: metricNumber(metrics, "fetchCalls"),
    modelCalls: metricNumber(metrics, "modelCalls"),
    providerDegradation: Array.isArray(metrics.degradations) && metrics.degradations.length > 0,
  };
}

export interface ResearchSourceView {
  id: string;
  kindLabel: string;
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;
  doi: string | null;
  url: string | null;
  isGraphDiscovered: boolean;
  graphRelations: string[];
  hasFullTextEvidence: boolean;
  hasMetadataOnlyEvidence: boolean;
  hasVisualEvidence: boolean;
  evidenceCount: number;
}

const SOURCE_KIND_LABELS: Record<string, string> = {
  web: "网页",
  academic_paper: "学术论文",
  arxiv: "arXiv 预印本",
  doi: "DOI 文献",
  pmid: "PubMed 文献",
  project_file: "项目资料",
};

export function researchSourceKindLabel(kind: string): string {
  return SOURCE_KIND_LABELS[kind] ?? "来源";
}

/**
 * 来源列表只从已持久化的 Evidence + 引用边派生：同一 canonical source 的多个
 * chunk 归并为一条，metadata-only 与 visual 证据明确标注。
 */
export function buildResearchSourceViews(input: {
  evidence: Array<{
    id: string;
    evidenceType: string;
    sourceSnapshot?: {
      sourceId?: string;
      metadata?: unknown;
      source?: {
        id: string;
        kind: string;
        title?: string | null;
        canonicalKey: string;
        canonicalUrl?: string | null;
        doi?: string | null;
        metadata?: unknown;
      } | null;
    } | null;
  }>;
  relations?: Array<{ sourceId: string; targetSourceId: string | null; relation: string }>;
}): ResearchSourceView[] {
  const graphTargets = new Map<string, Set<string>>();
  for (const relation of input.relations ?? []) {
    if (!relation.targetSourceId) continue;
    const set = graphTargets.get(relation.targetSourceId) ?? new Set<string>();
    set.add(relation.relation);
    graphTargets.set(relation.targetSourceId, set);
  }
  const byId = new Map<string, ResearchSourceView>();
  for (const evidence of input.evidence) {
    const source = evidence.sourceSnapshot?.source;
    if (!source) continue;
    const snapshotMetadata = evidence.sourceSnapshot?.metadata && typeof evidence.sourceSnapshot.metadata === "object" && !Array.isArray(evidence.sourceSnapshot.metadata)
      ? evidence.sourceSnapshot.metadata as Record<string, unknown>
      : {};
    const scope = snapshotMetadata.scope && typeof snapshotMetadata.scope === "object" && !Array.isArray(snapshotMetadata.scope)
      ? snapshotMetadata.scope as Record<string, unknown>
      : {};
    const scopeType = typeof scope.type === "string" ? scope.type : "";
    const sourceMetadata = source.metadata && typeof source.metadata === "object" && !Array.isArray(source.metadata)
      ? source.metadata as Record<string, unknown>
      : {};
    const existing = byId.get(source.id);
    const isVisual = evidence.evidenceType === "visual_observation";
    const isMetadataOnly = !isVisual && scopeType === "metadata_only";
    const isFullText = !isVisual && !isMetadataOnly && (scopeType === "bounded_evidence_slices" || scopeType === "bounded_excerpt");
    if (existing) {
      existing.evidenceCount += 1;
      existing.hasVisualEvidence ||= isVisual;
      existing.hasMetadataOnlyEvidence ||= isMetadataOnly;
      existing.hasFullTextEvidence ||= isFullText;
      continue;
    }
    const graphRelations = [...(graphTargets.get(source.id) ?? new Set<string>())];
    byId.set(source.id, {
      id: source.id,
      kindLabel: researchSourceKindLabel(source.kind),
      title: source.title ?? source.canonicalKey,
      authors: Array.isArray(sourceMetadata.authors)
        ? sourceMetadata.authors.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).slice(0, 12)
        : [],
      year: typeof sourceMetadata.year === "number" && Number.isFinite(sourceMetadata.year) ? sourceMetadata.year : null,
      venue: typeof sourceMetadata.venue === "string" && sourceMetadata.venue.trim() ? sourceMetadata.venue.trim() : null,
      doi: source.doi ?? null,
      url: source.canonicalUrl ?? (source.doi ? `https://doi.org/${source.doi}` : null),
      isGraphDiscovered: graphRelations.length > 0,
      graphRelations,
      hasFullTextEvidence: isFullText,
      hasMetadataOnlyEvidence: isMetadataOnly,
      hasVisualEvidence: isVisual,
      evidenceCount: 1,
    });
  }
  return [...byId.values()];
}

export interface ResearchSourceBadge {
  label: string;
  tone: "neutral" | "accent" | "caution";
}

/** 来源标签：区分 Web / 学术 / 项目 / 引用图发现 / 元数据 / 全文 / 图表证据。 */
export function researchSourceBadges(view: ResearchSourceView): ResearchSourceBadge[] {
  const badges: ResearchSourceBadge[] = [{ label: view.kindLabel, tone: "neutral" }];
  if (view.isGraphDiscovered) badges.push({ label: "由引用关系发现", tone: "accent" });
  if (view.hasFullTextEvidence) badges.push({ label: "全文片段", tone: "neutral" });
  if (view.hasMetadataOnlyEvidence) badges.push({ label: "仅摘要/元数据", tone: "caution" });
  if (view.hasVisualEvidence) badges.push({ label: "图表观察", tone: "accent" });
  return badges;
}

/** 引用图关系 → 可读 provenance 文案。 */
export function researchGraphProvenanceLabel(relation: string): string {
  const labels: Record<string, string> = {
    references: "引用（它引用的原始工作）",
    citations: "被引用（引用它的后续研究）",
    related_work: "相关工作",
  };
  return labels[relation] ?? relation;
}
