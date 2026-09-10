/**
 * Research → Sciverse filter intent derivation (deterministic, no model calls).
 *
 * The Research side only ever produces a *high-level* intent; the concrete
 * field + operator pairs are chosen and validated server-side by
 * `src/lib/tools/sciverse/filter-compiler.ts` against the live field catalog.
 *
 * Design rules:
 * - Filters are only produced from explicit question signals (review/survey,
 *   preprint, open access, journal vs conference, "influential work") or from
 *   the plan's own time range. No filter is applied "just because" a domain
 *   profile exists, so recall is never locked out by a default.
 * - The domain profile participates by choosing which signals it recognises
 *   and how strict it is (see `DOMAIN_SIGNAL_POLICY`), never by hardcoding a
 *   constraint the question cannot override.
 * - A filtered query that returns nothing still gets one relaxed retry in the
 *   tool handler, and the legacy academic adapters remain the fallback.
 */

import type { ResearchBudgetProfile } from "./contracts";
import { resolveResearchDomainProfile, type ResearchDomainProfileKey } from "./domain-profile";
import type { SciverseFilterIntent } from "@/lib/tools/sciverse/filter-compiler";

export interface ScholarlyFilterContext {
  question: string;
  domainProfileKey: string | null | undefined;
  budgetProfile: ResearchBudgetProfile;
  /** Research Plan 的时间范围文字（如 "2024-2026"）。 */
  planTimeRange?: string | null;
}

export interface DerivedScholarlyFilters {
  intent: SciverseFilterIntent;
  /** 命中的确定性信号，用于 provenance 与诊断。 */
  signals: string[];
  /** 从计划时间范围解析出的年份边界（会作为 typed basic filter 发送）。 */
  yearFrom?: number;
  yearTo?: number;
}

interface DomainSignalPolicy {
  /** 是否识别综述/系统综述信号。 */
  reviews: boolean;
  /** 是否识别预印本信号。 */
  preprints: boolean;
  /** 是否识别临床证据信号（medicine 专属）。 */
  clinical: boolean;
  /** 提问明确指向高影响力工作时，允许使用的引用分位上限。 */
  percentileOnInfluence: "top_10_percent" | "top_1_percent" | null;
}

const DOMAIN_SIGNAL_POLICY: Record<ResearchDomainProfileKey, DomainSignalPolicy> = {
  general: { reviews: true, preprints: true, clinical: false, percentileOnInfluence: "top_10_percent" },
  computer_science: { reviews: true, preprints: true, clinical: false, percentileOnInfluence: "top_10_percent" },
  medicine: { reviews: true, preprints: false, clinical: true, percentileOnInfluence: "top_10_percent" },
  // 法学文献以法域与官方渠道为主，Sciverse 只是 secondary 学理来源：
  // 不施加预印本/临床/引用分位等学术收敛条件。
  law: { reviews: true, preprints: false, clinical: false, percentileOnInfluence: null },
};

const REVIEW_SIGNALS = [
  "survey",
  "systematic review",
  "literature review",
  "meta-analysis",
  "meta analysis",
  "review of",
  "综述",
  "系统综述",
  "文献综述",
  "研究现状",
  "研究进展",
];

const PREPRINT_SIGNALS = ["preprint", "pre-print", "预印本", "未正式发表"];

const CLINICAL_SIGNALS = [
  "clinical trial",
  "randomized",
  "randomised",
  "rct",
  "guideline",
  "guidelines",
  "临床试验",
  "随机对照",
  "指南",
];

const OPEN_ACCESS_SIGNALS = ["open access", "open-access", "开放获取", "开放存取", "免费全文"];

const JOURNAL_SIGNALS = ["journal article", "journal paper", "期刊论文", "期刊文章", "sci 期刊"];
const CONFERENCE_SIGNALS = ["conference paper", "conference proceedings", "会议论文", "顶会"];

const INFLUENCE_SIGNALS = [
  "seminal",
  "influential",
  "highly cited",
  "highly-cited",
  "landmark",
  "state of the art",
  "state-of-the-art",
  "经典",
  "高被引",
  "奠基",
  "开创性",
];

function hasCjk(text: string): boolean {
  return /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(text);
}

function matches(text: string, signals: readonly string[]): boolean {
  return signals.some((signal) => text.includes(signal));
}

/**
 * 从计划的时间范围文字中解析年份边界。只接受确定性的四位数年份；解析不到
 * 就返回空，绝不猜测。
 */
export function parsePlanTimeRange(timeRange: string | null | undefined): { yearFrom?: number; yearTo?: number } {
  if (!timeRange || typeof timeRange !== "string") return {};
  const years = [...timeRange.matchAll(/(?:19|20)\d{2}/g)].map((match) => Number(match[0]));
  const unique = [...new Set(years)].filter((year) => year >= 1900 && year <= 2100).sort((a, b) => a - b);
  if (unique.length === 0) return {};
  if (unique.length === 1) {
    // 单一时间点：只有显式「自/以来/after」才当作下界，否则不施加边界。
    return /(以来|之后|以后|起|since|after|onwards|from)/i.test(timeRange)
      ? { yearFrom: unique[0] }
      : { yearFrom: unique[0], yearTo: unique[0] };
  }
  return { yearFrom: unique[0], yearTo: unique[unique.length - 1] };
}

/**
 * Derives a bounded Sciverse filter intent for one Research Question.
 *
 * Returns `null` when no signal applies — in that case the caller sends only
 * the plain query plus typed basic filters.
 */
export function deriveScholarlyFilterIntent(context: ScholarlyFilterContext): DerivedScholarlyFilters | null {
  const question = (context.question ?? "").trim();
  if (!question) return null;
  const profile = resolveResearchDomainProfile(context.domainProfileKey);
  const policy = DOMAIN_SIGNAL_POLICY[profile.key];
  const text = question.toLowerCase();
  const signals: string[] = [];

  const intent: SciverseFilterIntent = {};

  if (policy.reviews && matches(text, REVIEW_SIGNALS)) {
    intent.publicationTypes = ["review"];
    signals.push("review_requested");
  }
  if (policy.preprints && matches(text, PREPRINT_SIGNALS)) {
    intent.publicationTypes = ["preprint"];
    signals.push("preprint_requested");
  }
  if (policy.clinical && matches(text, CLINICAL_SIGNALS)) {
    intent.publicationTypes = ["clinical-trial"];
    signals.push("clinical_evidence_requested");
  }
  if (matches(text, OPEN_ACCESS_SIGNALS)) {
    intent.openAccess = true;
    signals.push("open_access_requested");
  }
  if (matches(text, JOURNAL_SIGNALS)) {
    intent.venueTypes = ["journal"];
    signals.push("journal_requested");
  } else if (matches(text, CONFERENCE_SIGNALS)) {
    intent.venueTypes = ["conference"];
    signals.push("conference_requested");
  }
  if (policy.percentileOnInfluence && matches(text, INFLUENCE_SIGNALS)) {
    intent.topPercentile = policy.percentileOnInfluence;
    signals.push("influence_requested");
  }
  // 非 CJK 提问且领域以英文文献为主时，用语言收敛提升 precision；法学不施加
  // 语言约束（法域文献常为本地语言），中文提问也不施加。
  if (profile.key !== "law" && !hasCjk(question)) {
    signals.push("latin_script_question");
  }

  const years = parsePlanTimeRange(context.planTimeRange);
  if (years.yearFrom !== undefined || years.yearTo !== undefined) signals.push("plan_time_range");

  if (Object.keys(intent).length === 0 && years.yearFrom === undefined && years.yearTo === undefined) {
    return null;
  }
  return {
    intent,
    signals,
    ...(years.yearFrom !== undefined ? { yearFrom: years.yearFrom } : {}),
    ...(years.yearTo !== undefined ? { yearTo: years.yearTo } : {}),
  };
}
