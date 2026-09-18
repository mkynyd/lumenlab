import type { ResearchCandidate } from "./source-provider";

/**
 * Candidate fetch 优先级（确定性、有界，不是 learned ranker）。排序键依次为：
 *
 * 1. domain profile 的 provider rank。preferredProviders 只是排序依据，不是
 *    allowlist：未列出的 provider 排在最后，但候选永远保留。
 * 2. 全文可读性：web / arxiv / project 与带 docId 的 Sciverse 论文能形成 chunk
 *    级 Evidence，优先于只能形成 metadata_only 快照的候选。Sciverse 的
 *    `is_content_accessible` 在 meta-search 上并不可靠（生产实测：即使返回了
 *    doc_id 且 /content 可读，该字段仍为 false），因此以 doc_id 存在与否为准。
 *    没有 docId 不等于无价值（仍提供 canonical identity 与元数据），只是在同
 *    rank 内排后，绝不 rejected。
 * 3. canonical identity：带 DOI 的候选优先，利于跨 provider 归并同一论文。
 * 4. 元数据完整度（authors/year/venue），作为最后的小信号。
 *
 * citationCount / FWCI 不参与 fetch 排序（只在 quality 评估里作有界辅助信号），
 * 避免“引用量高 = 先读”主导研究路径。Array.sort 稳定，同优先级保持发现顺序。
 */

const FULL_TEXT_PROVIDERS = new Set(["web", "arxiv", "project"]);

/**
 * 该候选能否产出正文/全文级证据（而非仅 metadata/abstract 级）。
 *
 * Sciverse 的判定以 doc_id 为准：doc_id 是全文 artifact 的内容哈希，只有存在
 * 全文时才会返回；`is_content_accessible` 在生产 meta-search 响应里恒为 false
 * （2026-09-11 实测 25 条结果中 12 条带 doc_id、0 条为 true，而其 /content 可读），
 * 因此不能作为读取门槛。
 */
export function canProduceFullTextEvidence(candidate: ResearchCandidate): boolean {
  if (candidate.provider === "sciverse") {
    const docId = candidate.metadata.docId;
    return (typeof docId === "string" && docId.trim().length > 0) || candidate.metadata.isContentAccessible === true;
  }
  return FULL_TEXT_PROVIDERS.has(candidate.provider);
}

function identityTier(candidate: ResearchCandidate): 0 | 1 {
  const doi = candidate.metadata.doi;
  return (typeof doi === "string" && doi.trim()) || candidate.kind === "doi" ? 0 : 1;
}

function metadataCompleteness(candidate: ResearchCandidate): number {
  const metadata = candidate.metadata;
  let score = 0;
  if (Array.isArray(metadata.authors) && metadata.authors.length > 0) score += 1;
  if (typeof metadata.year === "number" && Number.isFinite(metadata.year)) score += 1;
  if (typeof metadata.venue === "string" && metadata.venue.trim()) score += 1;
  return score;
}

export function prioritizeResearchCandidates(
  candidates: ResearchCandidate[],
  preferredProviders: string[] | undefined,
): ResearchCandidate[] {
  const rank = new Map((preferredProviders ?? []).map((provider, index) => [provider, index]));
  const unlistedRank = preferredProviders?.length ?? 0;
  return [...candidates].sort((left, right) =>
    (rank.get(left.provider) ?? unlistedRank) - (rank.get(right.provider) ?? unlistedRank)
    || Number(canProduceFullTextEvidence(right)) - Number(canProduceFullTextEvidence(left))
    || identityTier(left) - identityTier(right)
    || metadataCompleteness(right) - metadataCompleteness(left));
}

/**
 * Source Triage 候选窗口（确定性，durable 重放一致）：
 *
 * 生产事故：domain profile 把 project/sciverse 排在 web 之前，两者满页时
 * 12 席窗口被占满，web.search 的高相关结果被全量挤出（连 triage 都进不了），
 * 中文本地政策类主题 + 项目带附件时必现。因此窗口采用「家族保底 + 优先级填充」：
 *
 * 1. 先按 prioritizeResearchCandidates 全量排序；
 * 2. web 家族保底 min(TRIAGE_WEB_FLOOR, 实际 web 数) 席——只要 web.search
 *    有高相关结果，就不允许被全量挤出 triage；
 * 3. 其余席位按既定优先级顺序填充；
 * 4. 被淘汰的候选按 provider 计数返回（观测与候选持久化用）。
 *
 * 窗口不扩大：12 席与 triage prompt 的 12 候选上限、摘录字符预算同口径。
 */
export const TRIAGE_WINDOW_SIZE = 12;
export const TRIAGE_WEB_FLOOR = 3;

export interface TriageWindowSelection {
  selected: ResearchCandidate[];
  /** 因窗口溢出被淘汰的候选，按 provider 计数（如 { sciverse: 4 }）。 */
  droppedByProvider: Record<string, number>;
}

export function selectCandidatesForTriage(
  candidates: ResearchCandidate[],
  preferredProviders: string[] | undefined,
  windowSize: number = TRIAGE_WINDOW_SIZE,
): TriageWindowSelection {
  const prioritized = prioritizeResearchCandidates(candidates, preferredProviders);
  if (prioritized.length <= windowSize) {
    return { selected: prioritized, droppedByProvider: {} };
  }
  const selected: ResearchCandidate[] = [];
  const used = new Set<ResearchCandidate>();
  // 名额 1：web 家族保底（取优先级最高的前 N 个 web 候选）。
  const webCandidates = prioritized.filter((candidate) => candidate.provider === "web");
  for (const candidate of webCandidates.slice(0, Math.min(TRIAGE_WEB_FLOOR, windowSize))) {
    selected.push(candidate);
    used.add(candidate);
  }
  // 名额 2：其余席位按既定优先级填充（project/sciverse 的高优先级不被保底扭曲）。
  for (const candidate of prioritized) {
    if (selected.length >= windowSize) break;
    if (used.has(candidate)) continue;
    selected.push(candidate);
    used.add(candidate);
  }
  const droppedByProvider: Record<string, number> = {};
  for (const candidate of prioritized) {
    if (used.has(candidate)) continue;
    droppedByProvider[candidate.provider] = (droppedByProvider[candidate.provider] ?? 0) + 1;
  }
  return { selected, droppedByProvider };
}
