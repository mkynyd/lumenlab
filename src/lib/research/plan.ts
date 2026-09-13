import type {
  ResearchBudgetProfile,
  ResearchPlanSnapshot,
  ResearchPriority,
  ResearchIntentType,
} from "./contracts";
import type { ResearchPlannerDecision } from "./model-stage";
import { resolveResearchDomainProfile } from "./domain-profile";

const QUESTION_SPLITTER = /[？?；;。\n]+/;

function normalizeQuestion(value: string): string {
  return value.replace(/\s+/g, " ").trim().replace(/^[：:，,\s]+|[，,。；;\s]+$/g, "");
}

function splitResearchQuestions(question: string): string[] {
  const pieces = question.split(QUESTION_SPLITTER).map(normalizeQuestion).filter(Boolean);
  if (pieces.length <= 1) return [normalizeQuestion(question)];
  return pieces.slice(0, 8);
}

function inferTargetTimeRange(question: string): string | null {
  const range = question.match(/((?:19|20)\d{2})\s*年?\s*(?:[-–—~～至到])\s*((?:19|20)\d{2})\s*年?/);
  if (range) return `${range[1]}-${range[2]}`;
  const after = question.match(/((?:19|20)\d{2})\s*年\s*(后|以来|起)/);
  if (after) return `${after[1]} 年${after[2]}`;
  const single = question.match(/((?:19|20)\d{2})\s*年/);
  return single ? `${single[1]} 年` : null;
}

export function inferResearchIntent(question: string): ResearchIntentType {
  if (/(比较|对比|区别|差异|优劣|versus|\bvs\.?\b)/i.test(question)) return "comparison";
  if (/(趋势|现状|主要改进|主流|发展|演进|state of the art|sota)/i.test(question)) return "trend";
  if (/(综述|文献回顾|研究进展|literature review|survey)/i.test(question)) return "literature_review";
  if (/(原因|为什么|因果|导致|影响机制)/i.test(question)) return "causal";
  if (/(推荐|选择|最佳|应该|方案)/i.test(question)) return "recommendation";
  if (/(方法|算法|架构|机制|技术|模型|系统)/i.test(question)) return "technical_review";
  return "factual";
}

function semanticFallbackQuestions(objective: string, intentType: ResearchIntentType): string[] {
  if (intentType === "trend" || intentType === "literature_review" || intentType === "technical_review") {
    return [
      `界定“${objective}”的研究范围、概念边界与必要基线`,
      `归纳回答“${objective}”所需的主要机制、类别或发展方向`,
      `寻找各类别的代表性原始证据、比较证据与可量化结果`,
      `判断哪些结论有独立验证，哪些仅是新提案或邻近背景`,
      `比较适用条件、局限、负面证据与尚未解决的问题`,
    ];
  }
  if (intentType === "comparison") {
    return [`明确比较对象、共同基线与可比维度：${objective}`, `分别收集各对象的直接证据与适用边界`, `在一致条件下比较结果，并标明不可直接比较之处`];
  }
  if (intentType === "causal") {
    return [`明确候选原因、结果与时间顺序：${objective}`, "区分关联证据、机制证据与因果识别", "寻找替代解释、反证与适用边界"];
  }
  if (intentType === "recommendation") {
    return [`明确推荐目标、约束与判定标准：${objective}`, "比较候选方案的证据、成本、风险与适用条件", "形成带条件的建议并说明不确定性"];
  }
  return splitResearchQuestions(objective);
}

function priorityFor(index: number): ResearchPriority {
  return index === 0 ? "critical" : index < 4 ? "important" : "supporting";
}

export function buildResearchPlan(input: {
  question: string;
  profile: ResearchBudgetProfile;
  domainProfileKey?: string;
}): ResearchPlanSnapshot {
  const researchGoal = normalizeQuestion(input.question);
  const domainProfile = resolveResearchDomainProfile(input.domainProfileKey);
  const intentType = inferResearchIntent(researchGoal);
  const targetTimeRange = inferTargetTimeRange(researchGoal);
  const questions = semanticFallbackQuestions(researchGoal, intentType).slice(0, 6).map((item, index) => ({
    key: `q${index + 1}`,
    title: item.length > 48 ? `${item.slice(0, 48)}…` : item,
    question: item,
    priority: priorityFor(index),
    completionCriteria: ["至少一个直接证据", "至少一个独立来源或明确记录无法独立验证", ...domainProfile.evidenceStandards],
    sourceStrategy: [...domainProfile.sourcePriorities, "记录来源版本、时间与定位"],
  }));

  return {
    schemaVersion: "2",
    originalRequest: input.question,
    objective: researchGoal,
    intentType,
    targetTimeRange,
    evidenceTimeRange: targetTimeRange ? "以目标期内证据为主；允许必要的更早基线与后续验证" : null,
    scopeInclusions: ["直接回答用户问题的核心对象、机制与证据"],
    scopeExclusions: ["仅关键词相似但不回答研究问题的邻近主题"],
    assumptions: ["未明确的地域、语言与来源类型采用领域 Profile 的合理默认值"],
    evaluationDimensions: intentType === "comparison" ? ["共同基线", "机制", "效果", "适用条件", "局限"] : intentType === "trend" ? ["相对基线的变化", "机制类别", "证据强度", "独立验证", "实际意义", "局限"] : ["直接性", "可靠性", "时间适用性", "独立验证"],
    expectedOutput: "围绕原始问题组织、带证据强度与不确定性说明的结构化研究报告",
    researchGoal,
    scope: "围绕研究问题进行可核验的公开来源与已授权项目资料检索；超出该范围需重新确认。",
    timeRange: targetTimeRange,
    researchQuestions: questions,
    sourceStrategy: [
      "先检索候选来源，再成功读取后形成 Source Snapshot",
      ...domainProfile.sourcePriorities,
      "对重要结论记录独立交叉验证与冲突证据",
    ],
    completionCriteria: [
      "关键研究问题有直接证据或明确标注证据缺口",
      "重要事实的范围、日期和因果措辞与证据匹配",
      "报告中的事实性断言均可打开对应来源与 Evidence",
      ...domainProfile.citationRules,
    ],
    expectedOutputs: ["结构化研究报告", "Claim/Evidence/Source 索引", "引用核验与不确定性摘要", ...domainProfile.outputStructure],
    researchIntensity: input.profile,
    domainProfileKey: domainProfile.key,
    domainProfile: {
      name: domainProfile.name,
      sourcePriorities: domainProfile.sourcePriorities,
      evidenceStandards: domainProfile.evidenceStandards,
      citationRules: domainProfile.citationRules,
      outputStructure: domainProfile.outputStructure,
      preferredProviders: domainProfile.preferredProviders,
    },
  };
}

export function applyResearchPlannerDecision(
  plan: ResearchPlanSnapshot,
  decision: ResearchPlannerDecision,
): ResearchPlanSnapshot {
  const questions = decision.questions?.length
    ? decision.questions.filter((question) => question.question).slice(0, 8).map((question, index) => ({
        key: `q${index + 1}`,
        title: question.title || question.question!.slice(0, 48),
        question: question.question!,
        priority: question.priority ?? priorityFor(index),
        completionCriteria: question.completionCriteria?.length ? question.completionCriteria : ["至少一个直接证据或明确记录证据缺口"],
        sourceStrategy: question.sourceStrategy?.length ? question.sourceStrategy : ["优先官方、原始研究或项目资料"],
      }))
    : plan.researchQuestions;
  return {
    ...plan,
    ...(decision.objective ? { objective: decision.objective, researchGoal: decision.objective } : {}),
    ...(decision.intentType ? { intentType: decision.intentType } : {}),
    ...(decision.targetTimeRange !== undefined ? { targetTimeRange: decision.targetTimeRange } : {}),
    ...(decision.evidenceTimeRange !== undefined ? { evidenceTimeRange: decision.evidenceTimeRange } : {}),
    ...(decision.scopeInclusions?.length ? { scopeInclusions: decision.scopeInclusions } : {}),
    ...(decision.scopeExclusions?.length ? { scopeExclusions: decision.scopeExclusions } : {}),
    ...(decision.assumptions?.length ? { assumptions: decision.assumptions } : {}),
    ...(decision.evaluationDimensions?.length ? { evaluationDimensions: decision.evaluationDimensions } : {}),
    ...(decision.expectedOutput ? { expectedOutput: decision.expectedOutput } : {}),
    ...(decision.scope ? { scope: decision.scope } : {}),
    ...(decision.timeRange !== undefined ? { timeRange: decision.timeRange } : {}),
    ...(decision.sourceStrategy?.length ? { sourceStrategy: decision.sourceStrategy } : {}),
    ...(decision.completionCriteria?.length ? { completionCriteria: decision.completionCriteria } : {}),
    ...(decision.expectedOutputs?.length ? { expectedOutputs: decision.expectedOutputs } : {}),
    researchQuestions: questions,
  };
}

export type ResearchDirectiveImpact = "normal" | "scope_expansion" | "budget_expansion";

export function classifyResearchDirective(text: string): ResearchDirectiveImpact {
  const normalized = text.trim();
  if (/(预算|增加调用|增加模型|提高上限|更多时间|更高强度)/i.test(normalized)) {
    return "budget_expansion";
  }
  if (/(扩大|增加全部|覆盖所有|不限时间|更多来源|再研究一遍|预算|全面梳理)/i.test(normalized)) {
    return "scope_expansion";
  }
  return "normal";
}

export function applyResearchDirective(
  plan: ResearchPlanSnapshot,
  text: string
): ResearchPlanSnapshot {
  const directive = normalizeQuestion(text);
  if (!directive) return plan;
  const appended = plan.researchQuestions.length < 8
    ? [{
        key: `q${plan.researchQuestions.length + 1}`,
        title: directive.length > 48 ? `${directive.slice(0, 48)}…` : directive,
        question: directive,
        priority: "important" as const,
        completionCriteria: ["对新增方向给出直接证据或明确缺口"],
        sourceStrategy: ["沿用当前来源策略并记录新增方向"],
      }]
    : [];
  return {
    ...plan,
    researchGoal: `${plan.researchGoal}；补充方向：${directive}`,
    researchQuestions: [...plan.researchQuestions, ...appended],
  };
}
