/**
 * Citation Graph v1 — evidence-gap-driven scholarly graph expansion.
 *
 * 职责边界：
 * - 这里处理的是论文 ↔ 论文的引用/被引/相关工作关系（ResearchSourceRelation），
 *   与 ClaimEvidenceRelation（Claim ↔ Evidence 的语义支持）和 Sciverse Paper
 *   Schema 内部 entity relation 是三种完全不同的“关系”。
 * - citation edge 只证明“存在引用关系”，绝不是 Evidence；relation item 必须经
 *   正常 candidate → bounded read → Evidence 链路才能成为证据。
 * - 所有决策 deterministic：relation 选择、seed 评分、预算、分页、fingerprint
 *   都不调用模型，严禁 per-relation-item 的 LLM fan-out。
 */
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { normalizeDoi, buildSourceIdentity } from "./source-identity";
import { academicCitationSignal } from "./quality";
import type { ResearchBudgetProfile } from "./contracts";
import type { ResearchCandidate, ResearchProviderContext, ResearchSourceProvider, ResearchToolInvoker } from "./source-provider";
import type { ingestResearchReadSource } from "./evidence-ingestion";

// ─── Policy ─────────────────────────────────────────────────

export interface CitationGraphPolicy {
  enabled: boolean;
  maxSeedsPerQuestion: number;
  maxRelationsPerSeed: number;
  maxHops: number;
  pageSize: number;
  maxPagesPerSeedRelation: number;
  maxExpandedCandidatesPerQuestion: number;
  maxFetchedPerQuestion: number;
  maxGraphToolCallsPerRun: number;
}

const BASE_POLICY: Record<ResearchBudgetProfile, CitationGraphPolicy> = {
  // quick 必须足够轻：最多 1 seed、1 种关系、1 页、少量读取。
  quick: { enabled: true, maxSeedsPerQuestion: 1, maxRelationsPerSeed: 1, maxHops: 1, pageSize: 10, maxPagesPerSeedRelation: 1, maxExpandedCandidatesPerQuestion: 4, maxFetchedPerQuestion: 2, maxGraphToolCallsPerRun: 10 },
  deep: { enabled: true, maxSeedsPerQuestion: 2, maxRelationsPerSeed: 2, maxHops: 1, pageSize: 10, maxPagesPerSeedRelation: 1, maxExpandedCandidatesPerQuestion: 6, maxFetchedPerQuestion: 3, maxGraphToolCallsPerRun: 20 },
  comprehensive: { enabled: true, maxSeedsPerQuestion: 3, maxRelationsPerSeed: 2, maxHops: 2, pageSize: 15, maxPagesPerSeedRelation: 1, maxExpandedCandidatesPerQuestion: 10, maxFetchedPerQuestion: 4, maxGraphToolCallsPerRun: 36 },
};

/**
 * 领域调节系数：CS 积极使用引用图；general/medicine 标准；law 保守——
 * 论文关系不能压过官方 Web/法规渠道。
 */
const DOMAIN_SCALE: Record<string, number> = {
  computer_science: 1,
  general: 1,
  medicine: 1,
  law: 0.5,
};

export function resolveCitationGraphPolicy(
  profile: ResearchBudgetProfile,
  domainProfileKey: string | null | undefined,
): CitationGraphPolicy {
  const base = { ...BASE_POLICY[profile] };
  const scale = DOMAIN_SCALE[domainProfileKey ?? "general"] ?? 1;
  if (scale !== 1) {
    base.maxSeedsPerQuestion = Math.max(1, Math.floor(base.maxSeedsPerQuestion * scale));
    base.maxExpandedCandidatesPerQuestion = Math.max(2, Math.floor(base.maxExpandedCandidatesPerQuestion * scale));
    base.maxFetchedPerQuestion = Math.max(1, Math.floor(base.maxFetchedPerQuestion * scale));
  }
  return base;
}

// ─── Expansion need（deterministic） ────────────────────────

export type CitationExpansionNeed =
  | "missing_original_source"
  | "single_source_only"
  | "needs_recent_validation"
  | "conflicted_claim"
  | "insufficient_direct_evidence";

export interface CitationExpansionDecision {
  needed: boolean;
  needs: CitationExpansionNeed[];
  /** 选定的关系（按优先级），数量由 policy.maxRelationsPerSeed 截断。 */
  relations: Array<"references" | "citations" | "related_works">;
  reason: string;
}

const TIME_SENSITIVE_RE = /(最新|近年|近期|进展|趋势|202[4-9]|203\d|recent|latest|state[- ]of[- ]the[- ]art)/i;
const ORIGIN_RE = /(最早|最初|原始|首次提出|来源自|origin|first introduced|original)/i;

export function decideCitationExpansion(input: {
  questionStatus: string;
  questionText: string;
  activeEvidenceCount: number;
  independentSourceCount: number;
  timeRange: string | null;
  maxRelations: number;
}): CitationExpansionDecision {
  const needs: CitationExpansionNeed[] = [];
  const relations: Array<"references" | "citations" | "related_works"> = [];
  const timeSensitive = Boolean(input.timeRange) || TIME_SENSITIVE_RE.test(input.questionText);

  if (input.questionStatus === "controversial") {
    // 冲突：优先向前看后续研究（验证/修正/反驳）。
    needs.push("conflicted_claim");
    relations.push("citations");
  }
  if (input.questionStatus === "unresolved" || input.questionStatus === "partially_resolved") {
    needs.push("insufficient_direct_evidence");
    relations.push("references", "citations");
  }
  if (input.questionStatus === "resolved" && input.independentSourceCount < 2) {
    // 单一来源支持：找独立验证。
    needs.push("single_source_only");
    relations.push("citations", "related_works");
  }
  if (input.questionStatus === "resolved" && input.independentSourceCount >= 2 && timeSensitive) {
    needs.push("needs_recent_validation");
    relations.push("citations");
  }
  if (ORIGIN_RE.test(input.questionText)) {
    needs.push("missing_original_source");
    relations.unshift("references");
  }

  const uniqueRelations = [...new Set(relations)].slice(0, Math.max(1, input.maxRelations));
  return {
    needed: needs.length > 0 && input.activeEvidenceCount > 0,
    needs,
    relations: uniqueRelations,
    reason: needs.join("+") || "none",
  };
}

// ─── Seed selection（deterministic scoring） ────────────────

export interface GraphSeedInput {
  sourceId: string;
  canonicalKey: string;
  kind: string;
  title: string | null;
  doi: string | null;
  sciverseUniqueId: string | null;
  isContentAccessible: boolean;
  /** 该 source 在当前 Run 贡献的 active Evidence 数。 */
  activeEvidenceCount: number;
  year: number | null;
  citationCount: number | null;
  influentialCitationCount: number | null;
  fwci: number | null;
}

const SCHOLARLY_KINDS = new Set(["academic_paper", "arxiv", "doi", "pmid"]);

export function scoreGraphSeed(seed: GraphSeedInput, now = new Date()): number {
  let score = 0;
  // 实际贡献了 active Evidence 的来源是首要 seed 信号。
  score += Math.min(3, seed.activeEvidenceCount) * 2;
  // 没有 Sciverse uniqueId 也可以做 bounded identity resolution，但直接有的优先。
  if (seed.sciverseUniqueId) score += 4;
  if (seed.doi) score += 2;
  if (seed.isContentAccessible) score += 1;
  // citation 指标只作弱辅助（≤0.15），高被引不等于更真实/更相关。
  score += academicCitationSignal({ citationCount: seed.citationCount, influentialCitationCount: seed.influentialCitationCount, fwci: seed.fwci }) ?? 0;
  if (seed.year && seed.year >= now.getUTCFullYear() - 3) score += 0.5;
  return score;
}

export function selectGraphSeeds(candidates: GraphSeedInput[], policy: CitationGraphPolicy, now = new Date()): GraphSeedInput[] {
  return candidates
    .filter((candidate) => SCHOLARLY_KINDS.has(candidate.kind) && candidate.activeEvidenceCount > 0)
    .map((candidate) => ({ candidate, score: scoreGraphSeed(candidate, now) }))
    .sort((a, b) => b.score - a.score || a.candidate.canonicalKey.localeCompare(b.candidate.canonicalKey))
    .slice(0, policy.maxSeedsPerQuestion)
    .map((entry) => entry.candidate);
}

// ─── Target identity normalization ──────────────────────────

export interface GraphTargetIdentity {
  canonicalKey: string;
  doi: string | null;
  sciverseUniqueId: string | null;
  arxivId: string | null;
  /** 用于 ResearchSourceCandidate.externalId 的稳定标识。 */
  externalId: string;
  idType: string;
  title: string | null;
}

/**
 * 把 paper_relations item 归一化为稳定 identity。DOI 统一走 source-identity 的
 * normalizeDoi；Sciverse unique_id 常内嵌 DOI（paper:10.xxxx/…）；未知 id_type
 * 一律 provider-scoped，绝不臆造 DOI。
 */
export function normalizeGraphTarget(item: { id: string; idType: string; title?: string }): GraphTargetIdentity {
  const rawId = item.id.trim();
  const idType = item.idType.trim().toLowerCase() || "unknown";
  const title = typeof item.title === "string" && item.title.trim() ? item.title.trim() : null;

  let doi: string | null = null;
  let sciverseUniqueId: string | null = null;
  if (idType === "doi") {
    doi = normalizeDoi(rawId);
  }
  if (idType === "unique_id" || idType === "sciverse" || idType === "sciverse_internal" || /^paper:/i.test(rawId)) {
    sciverseUniqueId = rawId;
    // paper:10.1038/xxx 这类 unique_id 内嵌 DOI，可以安全提取。
    doi ??= normalizeDoi(rawId.replace(/^paper:/i, ""));
  }
  // 兜底：id 本身就是 DOI 形态（上游 id_type 标注不一致时）。
  doi ??= normalizeDoi(rawId);

  const arxivId = doi ? (doi.match(/^10\.48550\/arxiv\.(.+)$/i)?.[1] ?? null) : null;
  const identity = buildSourceIdentity({
    kind: "academic_paper",
    doi,
    providerScopedId: sciverseUniqueId
      ? { provider: "sciverse", id: sciverseUniqueId }
      : { provider: "sciverse_relation", id: `${idType}:${rawId}` },
  });
  return {
    canonicalKey: identity.canonicalKey,
    doi,
    sciverseUniqueId,
    arxivId,
    externalId: doi ?? sciverseUniqueId ?? rawId,
    idType,
    title,
  };
}

// ─── Edge idempotency ───────────────────────────────────────

export function buildCitationEdgeKey(input: { sourceId: string; relation: string; targetCanonicalKey: string }): string {
  return createHash("sha256")
    .update(`${input.sourceId}|${input.relation}|${input.targetCanonicalKey}`)
    .digest("hex")
    .slice(0, 32);
}

/** durable checkpoint 恢复用：questionId + seed + relation + page 的稳定 fingerprint。 */
export function buildCitationExpansionFingerprint(input: { questionId: string; seedSourceId: string; relation: string; page: number; hop: number }): string {
  return createHash("sha256")
    .update(`citation-expansion:v1:${input.questionId}:${input.seedSourceId}:${input.relation}:${input.page}:${input.hop}`)
    .digest("hex")
    .slice(0, 24);
}

// ─── Metrics ────────────────────────────────────────────────

export interface CitationGraphMetrics {
  graphSeedsExpanded: number;
  graphRelationCalls: number;
  graphEdgesDiscovered: number;
  graphCandidatesCreated: number;
  graphSourcesFetched: number;
  graphEvidenceAdded: number;
  graphDuplicateTargets: number;
  graphBudgetStops: number;
}

export function emptyCitationGraphMetrics(): CitationGraphMetrics {
  return {
    graphSeedsExpanded: 0,
    graphRelationCalls: 0,
    graphEdgesDiscovered: 0,
    graphCandidatesCreated: 0,
    graphSourcesFetched: 0,
    graphEvidenceAdded: 0,
    graphDuplicateTargets: 0,
    graphBudgetStops: 0,
  };
}

// ─── Expansion execution ────────────────────────────────────

interface SciverseRelationsResultLike {
  items?: Array<{ id?: unknown; idType?: unknown; title?: unknown }>;
  hasMore?: boolean;
  error?: string;
}

interface SciverseSearchResultLike {
  papers?: Array<Record<string, unknown>>;
  error?: string;
}

function json(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * 把 graph target 解析为可读取的 candidate：
 * 1. arXiv DOI（10.48550/arxiv.*）直接构造 arxiv candidate，零额外调用；
 * 2. 其余有 DOI/uniqueId 的 target 用一次 sciverse.search 做严格 identity
 *    resolution（只接受归一化 DOI 精确匹配，不做标题模糊匹配）；
 * 3. 无法解析的 target 只保留 edge，不创建虚假 candidate。
 */
async function resolveGraphTarget(
  runTool: ResearchToolInvoker,
  context: ResearchProviderContext,
  target: GraphTargetIdentity,
): Promise<ResearchCandidate | null> {
  if (target.arxivId) {
    return {
      provider: "arxiv",
      kind: "arxiv",
      externalId: target.arxivId,
      title: target.title ?? target.arxivId,
      url: `https://arxiv.org/abs/${target.arxivId}`,
      metadata: { doi: target.doi },
    };
  }
  if (!target.doi && !target.sciverseUniqueId) return null;
  const query = target.doi ?? target.sciverseUniqueId ?? "";
  const result = (await runTool(context, "sciverse.search", { query, pageSize: 3 })) as SciverseSearchResultLike | null;
  if (!result || result.error || !Array.isArray(result.papers)) return null;
  for (const paper of result.papers) {
    const paperDoi = normalizeDoi(asString(paper.doi));
    const paperUniqueId = asString(paper.uniqueId);
    const doiMatch = target.doi && paperDoi && paperDoi === target.doi;
    const uniqueMatch = target.sciverseUniqueId && paperUniqueId && paperUniqueId === target.sciverseUniqueId;
    if (!doiMatch && !uniqueMatch) continue;
    const title = asString(paper.title);
    if (!title || !paperUniqueId) return null;
    return {
      provider: "sciverse",
      kind: "academic_paper",
      externalId: target.doi ?? paperUniqueId,
      title,
      url: asString(paper.url) ?? (target.doi ? `https://doi.org/${target.doi}` : null),
      metadata: {
        doi: paperDoi ?? target.doi,
        docId: asString(paper.docId),
        uniqueId: paperUniqueId,
        authors: Array.isArray(paper.authors) ? paper.authors.filter((a): a is string => typeof a === "string") : [],
        year: typeof paper.year === "number" ? paper.year : null,
        venue: asString(paper.venue),
        citationCount: typeof paper.citationCount === "number" ? paper.citationCount : null,
        influentialCitationCount: typeof paper.influentialCitationCount === "number" ? paper.influentialCitationCount : null,
        fwci: typeof paper.fwci === "number" ? paper.fwci : null,
        isOpenAccess: paper.isOpenAccess === true,
        isContentAccessible: paper.isContentAccessible === true,
        abstractPreview: asString(paper.abstractPreview),
      },
    };
  }
  return null;
}

export interface CitationExpansionInput {
  userId: string;
  workspaceId: string;
  runId: string;
  questionId: string;
  questionText: string;
  seeds: GraphSeedInput[];
  relations: Array<"references" | "citations" | "related_works">;
  policy: CitationGraphPolicy;
  providerContext: ResearchProviderContext;
  provider: ResearchSourceProvider;
  runTool: ResearchToolInvoker;
  /** 已完成页的 fingerprint（lease recovery / retry 不重复调用）。 */
  processedFingerprints: Set<string>;
  /** 本 Run 已消耗的 graph 工具调用数（relation + identity resolution）。 */
  graphToolCallsUsed: number;
  /** 与主研究阶段共享的硬预算预留。 */
  tryReserve: (counter: "searchCalls" | "fetchCalls" | "sourceCount") => boolean;
  ingest: typeof ingestResearchReadSource;
}

export interface CitationExpansionOutput {
  processedFingerprints: string[];
  graphToolCallsUsed: number;
  metrics: CitationGraphMetrics;
  /** 本轮新 fetch 且有 uniqueId 的 source（hop-2 seed 候选）。 */
  fetchedSources: GraphSeedInput[];
}

/**
 * 执行一个 Question 的有界 citation expansion。任何 Sciverse 错误都是可恢复
 * degradation（记 metrics/事件后继续），不会让整个 Research Run 失败。
 */
export async function expandCitationGraphForQuestion(input: CitationExpansionInput): Promise<CitationExpansionOutput> {
  const { policy } = input;
  const metrics = emptyCitationGraphMetrics();
  const processed: string[] = [];
  let toolCalls = input.graphToolCallsUsed;
  let expandedCandidates = 0;
  let fetchedCount = 0;
  const fetchedSources: GraphSeedInput[] = [];

  const seedQueue: Array<{ seed: GraphSeedInput; hop: number }> = input.seeds.map((seed) => ({ seed, hop: 1 }));
  const expandedSeedIds = new Set<string>();

  while (seedQueue.length > 0) {
    const entry = seedQueue.shift()!;
    if (entry.hop > policy.maxHops) break;
    if (expandedSeedIds.has(entry.seed.sourceId)) continue;
    if (fetchedCount >= policy.maxFetchedPerQuestion || expandedCandidates >= policy.maxExpandedCandidatesPerQuestion) {
      metrics.graphBudgetStops += 1;
      break;
    }
    expandedSeedIds.add(entry.seed.sourceId);
    metrics.graphSeedsExpanded += 1;

    for (const relation of input.relations.slice(0, policy.maxRelationsPerSeed)) {
      for (let page = 1; page <= policy.maxPagesPerSeedRelation; page += 1) {
        const fingerprint = buildCitationExpansionFingerprint({ questionId: input.questionId, seedSourceId: entry.seed.sourceId, relation, page, hop: entry.hop });
        if (input.processedFingerprints.has(fingerprint)) continue;
        if (toolCalls >= policy.maxGraphToolCallsPerRun || !input.tryReserve("searchCalls")) {
          metrics.graphBudgetStops += 1;
          break;
        }
        toolCalls += 1;
        metrics.graphRelationCalls += 1;
        const relations = (await input.runTool(input.providerContext, "sciverse.paper_relations", {
          uniqueId: entry.seed.sciverseUniqueId,
          relation,
          page,
          pageSize: policy.pageSize,
        })) as SciverseRelationsResultLike | null;
        if (!relations || relations.error || !Array.isArray(relations.items)) {
          // 未配置 / 404 / 429 / 5xx：degradation，不再翻页，不影响 Run。
          break;
        }
        processed.push(fingerprint);

        // 先落 edge（发现层），只有进入有界候选池的 target 才创建 Candidate。
        const targets: GraphTargetIdentity[] = [];
        for (const rawItem of relations.items) {
          const id = asString(rawItem.id);
          const idType = asString(rawItem.idType) ?? "unknown";
          if (!id) continue;
          const target = normalizeGraphTarget({ id, idType, title: asString(rawItem.title) ?? undefined });
          const edgeKey = buildCitationEdgeKey({ sourceId: entry.seed.sourceId, relation, targetCanonicalKey: target.canonicalKey });
          const [existingSource, existingEdge] = await Promise.all([
            prisma.researchSource.findUnique({
              where: { workspaceId_canonicalKey: { workspaceId: input.workspaceId, canonicalKey: target.canonicalKey } },
              select: { id: true },
            }),
            prisma.researchSourceRelation.findUnique({
              where: { runId_edgeKey: { runId: input.runId, edgeKey } },
              select: { id: true, targetSourceId: true },
            }),
          ]);
          if (!existingEdge) {
            await prisma.researchSourceRelation.create({
              data: {
                workspaceId: input.workspaceId,
                runId: input.runId,
                questionId: input.questionId,
                sourceId: entry.seed.sourceId,
                targetSourceId: existingSource?.id ?? null,
                targetCanonicalKey: target.canonicalKey,
                relation: relation === "related_works" ? "related_work" : relation,
                provider: "sciverse",
                externalTargetId: target.externalId,
                externalTargetIdType: target.idType,
                hop: entry.hop,
                edgeKey,
                metadata: json({ title: target.title, seedUniqueId: entry.seed.sciverseUniqueId }),
              },
            });
            metrics.graphEdgesDiscovered += 1;
          } else if (existingSource && !existingEdge.targetSourceId) {
            // target 后来被归一化为 ResearchSource：补链接，不新建 edge。
            await prisma.researchSourceRelation.update({
              where: { id: existingEdge.id },
              data: { targetSourceId: existingSource.id },
            });
          }
          if (existingSource) metrics.graphDuplicateTargets += 1;
          targets.push(target);
        }

        // 候选池：DOI > uniqueId > 其它；只对有稳定 identity 的 target 做解析。
        const pool = targets
          .map((target) => ({ target, tier: target.doi ? 0 : target.sciverseUniqueId ? 1 : 2 }))
          .filter((entry2) => entry2.tier < 2)
          .sort((a, b) => a.tier - b.tier || a.target.canonicalKey.localeCompare(b.target.canonicalKey));
        for (const { target } of pool) {
          if (expandedCandidates >= policy.maxExpandedCandidatesPerQuestion || fetchedCount >= policy.maxFetchedPerQuestion) {
            metrics.graphBudgetStops += 1;
            break;
          }
          const existing = await prisma.researchSource.findUnique({
            where: { workspaceId_canonicalKey: { workspaceId: input.workspaceId, canonicalKey: target.canonicalKey } },
            select: { id: true },
          });
          if (existing) continue; // 已归并的 canonical source 不重复 fetch。

          let candidate: ResearchCandidate | null = null;
          if (target.arxivId) {
            candidate = await resolveGraphTarget(input.runTool, input.providerContext, target);
          } else {
            if (toolCalls >= policy.maxGraphToolCallsPerRun || !input.tryReserve("searchCalls")) {
              metrics.graphBudgetStops += 1;
              break;
            }
            toolCalls += 1;
            candidate = await resolveGraphTarget(input.runTool, input.providerContext, target);
          }
          if (!candidate) continue;
          expandedCandidates += 1;
          metrics.graphCandidatesCreated += 1;

          const savedCandidate = await prisma.researchSourceCandidate.upsert({
            where: { runId_provider_externalId: { runId: input.runId, provider: candidate.provider, externalId: candidate.externalId } },
            create: {
              workspaceId: input.workspaceId,
              runId: input.runId,
              questionId: input.questionId,
              provider: candidate.provider,
              externalId: candidate.externalId,
              title: candidate.title,
              url: candidate.url,
              status: "selected",
              metadata: json({
                ...candidate.metadata,
                discovery: "sciverse.paper_relations",
                seedSourceId: entry.seed.sourceId,
                seedUniqueId: entry.seed.sciverseUniqueId,
                relation,
                hop: entry.hop,
                idType: target.idType,
              }),
            },
            update: {},
          });
          if (savedCandidate.status === "fetched") continue;

          if (!input.tryReserve("fetchCalls") || !input.tryReserve("sourceCount")) break;
          const read = await input.provider.read(
            { ...input.providerContext, question: input.questionText },
            {
              ...candidate,
              metadata: { ...candidate.metadata },
            },
          );
          if (!read) {
            await prisma.researchSourceCandidate.updateMany({ where: { id: savedCandidate.id, status: { not: "fetched" } }, data: { status: "rejected" } });
            continue;
          }
          const saved = await input.ingest({ userId: input.userId, workspaceId: input.workspaceId, runId: input.runId, questionId: input.questionId, read });
          if (!saved) continue;
          fetchedCount += 1;
          metrics.graphSourcesFetched += 1;
          metrics.graphEvidenceAdded += saved.evidences.length;
          await prisma.researchSourceCandidate.update({ where: { id: savedCandidate.id }, data: { status: "fetched", researchSourceId: saved.source.id } });
          // edge 链接到归一化后的 canonical target source。
          await prisma.researchSourceRelation.updateMany({
            where: { runId: input.runId, targetCanonicalKey: target.canonicalKey, targetSourceId: null },
            data: { targetSourceId: saved.source.id },
          });
          const metadata = (read.candidate.metadata ?? {}) as Record<string, unknown>;
          const uniqueId = asString(metadata.uniqueId);
          if (entry.hop < policy.maxHops && uniqueId) {
            fetchedSources.push({
              sourceId: saved.source.id,
              canonicalKey: saved.source.canonicalKey,
              kind: read.candidate.kind,
              title: read.title,
              doi: asString(metadata.doi),
              sciverseUniqueId: uniqueId,
              isContentAccessible: metadata.isContentAccessible === true,
              activeEvidenceCount: saved.evidences.length,
              year: typeof metadata.year === "number" ? metadata.year : null,
              citationCount: typeof metadata.citationCount === "number" ? metadata.citationCount : null,
              influentialCitationCount: typeof metadata.influentialCitationCount === "number" ? metadata.influentialCitationCount : null,
              fwci: typeof metadata.fwci === "number" ? metadata.fwci : null,
            });
          }
        }
        // 第一页已经足够时不翻页；只有明确还有更多且候选池空时才继续。
        if (!relations.hasMore || expandedCandidates > 0) break;
      }
    }

    // hop-2：仅 comprehensive 级别允许，seed 来自本轮新 fetch 的 canonical source。
    if (entry.hop < policy.maxHops && fetchedSources.length > 0 && seedQueue.length === 0) {
      for (const source of fetchedSources.slice(0, policy.maxSeedsPerQuestion)) {
        seedQueue.push({ seed: source, hop: entry.hop + 1 });
      }
    }
  }

  return { processedFingerprints: processed, graphToolCallsUsed: toolCalls, metrics, fetchedSources };
}

/**
 * Seed 缺 Sciverse uniqueId 时的有界 identity resolution：
 * 只接受 DOI 精确匹配（一次 sciverse.search），成功则把 uniqueId 合并进
 * ResearchSource metadata（不新建重复 source），失败则放弃该 seed。
 */
export async function resolveSeedSciverseUniqueId(
  runTool: ResearchToolInvoker,
  context: ResearchProviderContext,
  seed: GraphSeedInput,
): Promise<string | null> {
  if (seed.sciverseUniqueId) return seed.sciverseUniqueId;
  if (!seed.doi) return null;
  const result = (await runTool(context, "sciverse.search", { query: seed.doi, pageSize: 3 })) as SciverseSearchResultLike | null;
  if (!result || result.error || !Array.isArray(result.papers)) return null;
  for (const paper of result.papers) {
    if (normalizeDoi(asString(paper.doi)) !== seed.doi) continue;
    const uniqueId = asString(paper.uniqueId);
    if (!uniqueId) continue;
    const existing = await prisma.researchSource.findUnique({ where: { id: seed.sourceId }, select: { metadata: true } });
    const metadata = existing?.metadata && typeof existing.metadata === "object" && !Array.isArray(existing.metadata) ? existing.metadata as Record<string, unknown> : {};
    await prisma.researchSource.update({
      where: { id: seed.sourceId },
      data: { metadata: json({ ...metadata, sciverseUniqueId: uniqueId }) },
    });
    return uniqueId;
  }
  return null;
}
