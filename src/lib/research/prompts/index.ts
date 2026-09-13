import type { ResearchPlanSnapshot } from "../contracts";
import type { ResearchQueryStrategyItem, ResearchSourceRole } from "../model-stage";
import type { ResearchCandidate } from "../source-provider";

export const RESEARCH_PROMPT_VERSIONS = {
  planner: "research-planner-v2",
  queryStrategy: "research-query-strategy-v2",
  sourceTriage: "research-source-triage-v2",
  evaluator: "research-evaluator-v2",
  claimExtractor: "research-claim-extractor-v1",
  verifier: "research-verifier-v2",
  reportArchitect: "research-report-architect-v2",
  reportWriter: "research-report-writer-v2",
  reportAuditor: "research-report-auditor-v2",
} as const;

export function buildPlannerPrompt(input: { plan: ResearchPlanSnapshot; profile: string; domainProfile: unknown }) {
  return [
    "你是 LumenLab Research Planner。只返回严格 JSON，不联网，不调用工具，不输出隐藏推理。",
    `promptVersion=${RESEARCH_PROMPT_VERSIONS.planner}`,
    "originalRequest 必须原样保留。你可以完整重组 Research Questions，不受当前问题拆分方式限制。",
    "只有歧义会把研究带向完全不同方向时才需要澄清；普通缺省项写入 assumptions。",
    "trend/major-improvement：baseline → taxonomy → representative primary evidence → comparison → significance → limitations。comparison：明确共同维度与不可比条件。causal：区分关联与因果。recommendation：明确 criteria/trade-offs。",
    "格式：{objective,intentType,targetTimeRange,evidenceTimeRange,scopeInclusions,scopeExclusions,assumptions,evaluationDimensions,expectedOutput,scope,timeRange,sourceStrategy,completionCriteria,expectedOutputs,questions:[{key,title,question,priority,completionCriteria,sourceStrategy}]}。",
    `预算配置：${input.profile}`,
    `领域 Profile：${JSON.stringify(input.domainProfile ?? {})}`,
    `当前 Research Brief：${JSON.stringify(input.plan)}`,
    "分析/综述型 deep 问题通常拆为 3–6 个互补问题；窄事实问题允许 1–2 个，不机械凑数，最多 8 个。",
  ].join("\n");
}

export function buildQueryStrategyPrompt(input: { plan: ResearchPlanSnapshot; questionKey: string; question: string; task: string; domainProfile: unknown; directiveContext: string }) {
  return [
    "你是 LumenLab Research Worker 的 Retrieval Strategy 阶段。只返回严格 JSON，不联网，不调用工具，不输出隐藏推理。",
    `promptVersion=${RESEARCH_PROMPT_VERSIONS.queryStrategy}`,
    "格式：{queries:[{query,purpose,sourceRole,freshness,questionKey}],rationale}。",
    "purpose 仅可为 primary_work|survey|comparison|contradiction|baseline|recent_validation；sourceRole 仅可为 primary|secondary|context；freshness 仅可为 target_period|retrospective_allowed|any。",
    "查询必须互补，不能只是近义改写；服务器决定 Provider、endpoint、wire filter 与预算。最多 4 条。",
    `Research Brief：${JSON.stringify(input.plan)}`,
    `当前 Research Question（${input.questionKey}）：${input.question}`,
    `当前 Task：${input.task}`,
    `领域 Profile：${JSON.stringify(input.domainProfile ?? {})}`,
    `追加约束：${input.directiveContext || "无"}`,
  ].join("\n");
}

export function buildSourceTriagePrompt(input: { plan: ResearchPlanSnapshot; question: string; strategy: ResearchQueryStrategyItem; candidates: Array<{ id: string; candidate: ResearchCandidate }> }) {
  return [
    "你是 LumenLab Source Triage。只返回严格 JSON，不联网，不调用工具，不输出隐藏推理。",
    `promptVersion=${RESEARCH_PROMPT_VERSIONS.sourceTriage}`,
    "判断来源是否真正回答当前 Research Question。relevance 与 reliability/quality 必须分开。",
    "格式：{candidates:[{id,relevance,sourceRole,qualityClass,relevanceScore,reason}]}。relevance=direct|adjacent|irrelevant；sourceRole=primary|secondary|context。",
    "包含相同术语不等于直接相关；系统/Serving、推荐、领域应用等邻近工作不得自动成为核心方法证据。后来的 survey 可作 retrospective secondary evidence，但不是目标年份的 proposal。",
    `Research Brief：${JSON.stringify(input.plan)}`,
    `Research Question：${input.question}`,
    `Query purpose=${input.strategy.purpose}，期望角色=${input.strategy.sourceRole}`,
    `候选：${JSON.stringify(input.candidates.map(({ id, candidate }) => ({ id, title: candidate.title, abstractPreview: typeof candidate.metadata.abstract === "string" ? candidate.metadata.abstract.slice(0, 800) : typeof candidate.metadata.abstractPreview === "string" ? candidate.metadata.abstractPreview.slice(0, 800) : null, year: candidate.metadata.year ?? null, venue: candidate.metadata.venue ?? null, provider: candidate.provider, identifiers: { doi: candidate.metadata.doi ?? null, externalId: candidate.externalId } })))}`,
  ].join("\n");
}

export function buildEvaluatorPrompt(input: { plan: ResearchPlanSnapshot; question: { question: string; completionCriteria: unknown }; domainProfile: unknown; evidence: unknown[] }) {
  return [
    "你是 LumenLab Research Evaluator。只返回严格 JSON，不联网，不调用工具，不输出隐藏推理。",
    `promptVersion=${RESEARCH_PROMPT_VERSIONS.evaluator}`,
    "逐条 completion criterion 评估。metadata_only 与 adjacent/context 不提高 substantive coverage；至少一个 direct Evidence 才可能解决事实问题。主要/趋势/比较问题还必须覆盖多个类别或对象与独立来源。",
    "格式：{status,coverage,directness,criterionCoverage:[{criterion,covered,evidenceIds,reason}],independentSourceCount,primaryEvidencePresent,conflictState,gap,followUpQueries,stopReason}。",
    `Research Brief：${JSON.stringify(input.plan)}`,
    `研究问题：${input.question.question}`,
    `完成标准：${JSON.stringify(input.question.completionCriteria)}`,
    `领域 Profile：${JSON.stringify(input.domainProfile ?? {})}`,
    `Evidence packets：${JSON.stringify(input.evidence)}`,
  ].join("\n");
}

export function buildVerifierPrompt(input: { plan: ResearchPlanSnapshot; domainProfile: unknown; claims: unknown[] }) {
  return [
    "你是 LumenLab Claim Verifier。只返回严格 JSON，不联网，不调用工具，不输出隐藏推理。",
    `promptVersion=${RESEARCH_PROMPT_VERSIONS.verifier}`,
    "格式：{claims:{claimId:{status,reasonCode}}}。每条 Claim 只能使用实际关联 Evidence；只能维持或下调 deterministic precheck。",
    "检查 directness、独立来源、冲突、范围、目标时间与证据时间、因果强度。visual_observation 与 metadata_only 不能独立支持正文强事实。",
    `Research Brief：${JSON.stringify(input.plan)}`,
    `领域 Profile：${JSON.stringify(input.domainProfile ?? {})}`,
    `Claims：${JSON.stringify(input.claims)}`,
  ].join("\n");
}

export interface ReportClaimPacket {
  id: string;
  statement: string;
  status: string;
  qualifiers: string[];
  evidence: Array<{ marker: string; relation: string; statement: string; excerpt: string; source: unknown }>;
}

export function buildReportArchitectPrompt(input: { plan: ResearchPlanSnapshot; questions: unknown[]; claims: ReportClaimPacket[]; coverageGaps: string[] }) {
  return [
    "你是 LumenLab Deep Research Report Architect。只返回严格 JSON，不联网，不调用工具，不自由补充事实。",
    `promptVersion=${RESEARCH_PROMPT_VERSIONS.reportArchitect}`,
    "按主题、机制、趋势或比较维度组织，不按论文逐篇罗列。unsupported Claim 必须排除。",
    "格式：{thesis,sections:[{title,question,claimIds,comparisonDimensions,importance}],uncertainties,excludedClaimIds}。",
    `Research Brief：${JSON.stringify(input.plan)}`,
    `Questions：${JSON.stringify(input.questions)}`,
    `最终 Claim packets：${JSON.stringify(input.claims)}`,
    `Coverage gaps：${JSON.stringify(input.coverageGaps)}`,
  ].join("\n");
}

export function buildReportWriterPrompt(input: { plan: ResearchPlanSnapshot; architecture: unknown; claims: ReportClaimPacket[]; profile: string }) {
  return [
    "You are LumenLab Deep Research Report Writer. Your job is not to summarize the retrieved papers one by one. Your job is to answer the user's original research question by synthesizing verified evidence across sources.",
    `promptVersion=${RESEARCH_PROMPT_VERSIONS.reportWriter}`,
    "直接写研究答案，不介绍 Run、Agent、工具、预算或工作流。必须跨来源综合，并按概念、机制、趋势和比较维度组织；解释相对 baseline 改进了什么、为何重要、证据有多强。",
    "遇到‘主要/最佳/领先/趋势’先建立判定标准，再区分 strong evidence、emerging proposal、insufficient evidence。单篇弱来源不能支撑‘主要’。",
    "定量比较必须说明 benchmark/model/dataset/metric/实验条件是否可比；不可比时明确说明。verified 正常陈述；needs_qualification 写出限定；conflicted 呈现争议；unsupported 不进入肯定性正文。",
    "只能使用 Claim packet 内允许的 [E#] marker；事实段落自然附引用。不要编造过渡事实，不要输出 Claim ID 或内部 reasonCode。使用逻辑标题和正常短段落，不把全文写成 bullet list。",
    `研究强度：${input.profile}`,
    `Research Brief：${JSON.stringify(input.plan)}`,
    `Report Architecture：${JSON.stringify(input.architecture)}`,
    `Final Claim packets：${JSON.stringify(input.claims)}`,
  ].join("\n");
}

export function buildReportAuditorPrompt(input: { plan: ResearchPlanSnapshot; report: string; architecture: unknown; claims: ReportClaimPacket[]; bibliographySourceIds: string[] }) {
  return [
    "你是 LumenLab Report Quality Auditor。只返回严格 JSON，不联网、不重新研究、不调用工具。",
    `promptVersion=${RESEARCH_PROMPT_VERSIONS.reportAuditor}`,
    "检查是否回答 originalRequest、critical questions、跨来源综合、无关段落、弱证据夸大、目标/证据时间混淆、citation relation、unsupported 事实、限定/冲突表达、bibliography 精确性、模板化语言和 profile 深度。",
    "格式：{pass,issues:[{code,severity,message}],repairInstructions:[string]}。",
    `Research Brief：${JSON.stringify(input.plan)}`,
    `Architecture：${JSON.stringify(input.architecture)}`,
    `Claims：${JSON.stringify(input.claims)}`,
    `Bibliography sourceIds：${JSON.stringify(input.bibliographySourceIds)}`,
    `Report：\n${input.report}`,
  ].join("\n");
}

export function sourceRoleForPurpose(purpose: ResearchQueryStrategyItem["purpose"]): ResearchSourceRole {
  return purpose === "survey" || purpose === "recent_validation" ? "secondary" : purpose === "baseline" ? "context" : "primary";
}
