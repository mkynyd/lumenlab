import type { ResearchQueryStrategyItem, ResearchSourceRole } from "./model-stage";
import type { ResearchCandidate } from "./source-provider";

export type SourceRelevance = "direct" | "adjacent" | "irrelevant";
export type SourceQualityClass = "official_standard" | "primary_peer_reviewed" | "primary_preprint" | "secondary_review" | "grey_literature" | "context_source";

export interface SourceAssessment {
  relevance: SourceRelevance;
  sourceRole: ResearchSourceRole;
  qualityClass: SourceQualityClass;
  relevanceScore: number;
  reason: string;
}

const STOP = new Set(["的", "了", "与", "和", "或", "在", "年", "主要", "方法", "改进", "研究", "analysis", "method", "methods", "study", "2025", "2024", "2026"]);
const ADJACENT_SIGNALS = /\b(serving|inference|recommendation|recommender|multimodal|multi-modal|application|domain)\b|服务|推理系统|推荐系统|多模态推荐/i;
const CORE_ROUTING_SIGNALS = /\b(rout(?:e|er|ing)|expert selection|load balanc|token dispatch|expert choice|top[- ]?k|gating)\b|路由|专家选择|负载均衡|门控/i;
const MOE_SIGNAL = /\bmixture[- ]of[- ]experts\b|\bmoe\b|混合专家/i;

function tokens(value: string): Set<string> {
  return new Set(value.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}-]{1,}/gu)?.filter((item) => !STOP.has(item)) ?? []);
}

function overlapScore(question: string, title: string) {
  const expected = tokens(question);
  const actual = tokens(title);
  if (expected.size === 0) return 0;
  let overlap = 0;
  for (const token of expected) if (actual.has(token)) overlap += 1;
  return overlap / expected.size;
}

export function assessSourceQuality(candidate: ResearchCandidate): SourceQualityClass {
  const venue = typeof candidate.metadata.venue === "string" ? candidate.metadata.venue : "";
  const title = candidate.title;
  const url = candidate.url ?? "";
  if (candidate.kind === "arxiv" || /arxiv|preprint/i.test(venue)) return "primary_preprint";
  if (/survey|review|systematic review|meta-analysis|综述/i.test(`${title} ${venue}`)) return "secondary_review";
  if (/ssrn|authorea|working paper/i.test(`${venue} ${url}`)) return "grey_literature";
  if (/standard|guideline|official|government|\.gov\b|标准|指南/i.test(`${title} ${venue} ${url}`)) return "official_standard";
  if (candidate.kind === "academic_paper" || candidate.kind === "doi" || candidate.kind === "pmid") return "primary_peer_reviewed";
  return "context_source";
}

export function deterministicSourceAssessment(input: { question: string; strategy: ResearchQueryStrategyItem; candidate: ResearchCandidate }): SourceAssessment {
  const abstract = typeof input.candidate.metadata.abstract === "string"
    ? input.candidate.metadata.abstract
    : typeof input.candidate.metadata.abstractPreview === "string"
      ? input.candidate.metadata.abstractPreview
      : "";
  const text = `${input.candidate.title} ${abstract.slice(0, 1_000)}`;
  const lexical = overlapScore(input.question, text);
  const asksMoeRouting = MOE_SIGNAL.test(input.question) && CORE_ROUTING_SIGNALS.test(input.question);
  const hasMoe = MOE_SIGNAL.test(text);
  const hasRouting = CORE_ROUTING_SIGNALS.test(text);
  let relevance: SourceRelevance;
  let score: number;
  let reason: string;
  if (asksMoeRouting && !hasMoe && !hasRouting) {
    relevance = "irrelevant";
    score = Math.min(0.15, lexical);
    reason = "与 MoE routing 核心概念无语义交集";
  } else if (asksMoeRouting && hasMoe && !hasRouting) {
    relevance = "adjacent";
    score = ADJACENT_SIGNALS.test(text) ? 0.42 : 0.52;
    reason = "涉及 MoE，但没有直接表明研究 routing mechanism";
  } else if (asksMoeRouting && hasMoe && hasRouting) {
    relevance = ADJACENT_SIGNALS.test(text) && input.strategy.purpose !== "comparison" ? "adjacent" : "direct";
    score = relevance === "direct" ? 0.9 : 0.62;
    reason = relevance === "direct" ? "直接涉及 MoE routing mechanism" : "同时包含 routing 与邻近应用/系统语境";
  } else if (lexical < 0.08) {
    // A lexical miss is not a safe semantic rejection: translated titles,
    // abbreviations and provider metadata routinely have zero token overlap.
    // Keep it as adjacent so the batch model triage can refine it. Only the
    // explicit domain mismatch rules above are deterministic hard rejects.
    relevance = "adjacent";
    score = Math.max(0.2, lexical);
    reason = "词面交集不足，保留为邻近候选等待语义判定";
  } else {
    relevance = lexical >= 0.34 ? "direct" : "adjacent";
    score = Math.min(0.9, Math.max(0.2, lexical));
    reason = relevance === "direct" ? "主题与当前研究问题直接重合" : "主题相关但更适合作为背景或旁证";
  }
  return {
    relevance,
    sourceRole: relevance === "direct" ? input.strategy.sourceRole : "context",
    qualityClass: assessSourceQuality(input.candidate),
    relevanceScore: score,
    reason,
  };
}

export function normalizeSourceTriageDecision(value: unknown, ids: Set<string>): Record<string, SourceAssessment> {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const result: Record<string, SourceAssessment> = {};
  if (!Array.isArray(record.candidates)) return result;
  for (const raw of record.candidates.slice(0, 12)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.id !== "string" || !ids.has(item.id)) continue;
    const relevance = item.relevance === "direct" || item.relevance === "adjacent" || item.relevance === "irrelevant" ? item.relevance : null;
    const sourceRole = item.sourceRole === "primary" || item.sourceRole === "secondary" || item.sourceRole === "context" ? item.sourceRole : null;
    const qualityClass = item.qualityClass === "official_standard" || item.qualityClass === "primary_peer_reviewed" || item.qualityClass === "primary_preprint" || item.qualityClass === "secondary_review" || item.qualityClass === "grey_literature" || item.qualityClass === "context_source" ? item.qualityClass : null;
    if (!relevance || !sourceRole || !qualityClass) continue;
    result[item.id] = { relevance, sourceRole, qualityClass, relevanceScore: typeof item.relevanceScore === "number" && Number.isFinite(item.relevanceScore) ? Math.max(0, Math.min(1, item.relevanceScore)) : relevance === "direct" ? 0.8 : relevance === "adjacent" ? 0.5 : 0, reason: typeof item.reason === "string" ? item.reason.slice(0, 300) : "模型批量相关性判定" };
  }
  return result;
}

/** Deterministic irrelevant is a hard floor; model may otherwise refine a borderline candidate. */
export function mergeSourceAssessments(deterministic: SourceAssessment, model: SourceAssessment | undefined): SourceAssessment {
  if (deterministic.relevance === "irrelevant") return deterministic;
  if (!model) return deterministic;
  return { ...model, qualityClass: deterministic.qualityClass };
}
