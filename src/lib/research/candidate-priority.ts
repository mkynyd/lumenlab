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
