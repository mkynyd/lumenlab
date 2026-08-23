import type {
  ResearchBudgetProfile,
  ResearchPlanSnapshot,
  ResearchPriority,
} from "./contracts";
import type { ResearchPlannerDecision } from "./model-stage";

const QUESTION_SPLITTER = /[？?；;。\n]+/;

function normalizeQuestion(value: string): string {
  return value.replace(/\s+/g, " ").trim().replace(/^[：:，,\s]+|[，,。；;\s]+$/g, "");
}

function splitResearchQuestions(question: string): string[] {
  const pieces = question.split(QUESTION_SPLITTER).map(normalizeQuestion).filter(Boolean);
  if (pieces.length <= 1) return [normalizeQuestion(question)];
  return pieces.slice(0, 8);
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
  const questions = splitResearchQuestions(researchGoal).map((item, index) => ({
    key: `q${index + 1}`,
    title: item.length > 48 ? `${item.slice(0, 48)}…` : item,
    question: item,
    priority: priorityFor(index),
    completionCriteria: ["至少一个直接证据", "至少一个独立来源或明确记录无法独立验证"],
    sourceStrategy: ["优先官方、原始研究或项目资料", "记录来源版本、时间与定位"],
  }));

  return {
    schemaVersion: "1",
    researchGoal,
    scope: "围绕研究问题进行可核验的公开来源与已授权项目资料检索；超出该范围需重新确认。",
    timeRange: null,
    researchQuestions: questions,
    sourceStrategy: [
      "先检索候选来源，再成功读取后形成 Source Snapshot",
      "学术问题优先使用原始论文、官方文档、项目资料和可追溯数据",
      "对重要结论记录独立交叉验证与冲突证据",
    ],
    completionCriteria: [
      "关键研究问题有直接证据或明确标注证据缺口",
      "重要事实的范围、日期和因果措辞与证据匹配",
      "报告中的事实性断言均可打开对应来源与 Evidence",
    ],
    expectedOutputs: ["结构化研究报告", "Claim/Evidence/Source 索引", "引用核验与不确定性摘要"],
    researchIntensity: input.profile,
    domainProfileKey: input.domainProfileKey ?? "general",
  };
}

export function applyResearchPlannerDecision(
  plan: ResearchPlanSnapshot,
  decision: ResearchPlannerDecision,
): ResearchPlanSnapshot {
  const knownKeys = new Set(plan.researchQuestions.map((question) => question.key));
  const questions = plan.researchQuestions.map((question) => {
    const update = decision.questions?.find((candidate) => candidate.key === question.key);
    if (!update) return question;
    return {
      ...question,
      ...(update.title ? { title: update.title } : {}),
      ...(update.question ? { question: update.question } : {}),
      ...(update.priority ? { priority: update.priority } : {}),
      ...(update.completionCriteria?.length ? { completionCriteria: update.completionCriteria } : {}),
      ...(update.sourceStrategy?.length ? { sourceStrategy: update.sourceStrategy } : {}),
    };
  });
  const extraQuestions = (decision.questions ?? [])
    .filter((question) => !knownKeys.has(question.key) && question.question)
    .slice(0, Math.max(0, 8 - questions.length))
    .map((question, index) => ({
      key: question.key,
      title: question.title || question.question!.slice(0, 48),
      question: question.question!,
      priority: question.priority ?? priorityFor(questions.length + index),
      completionCriteria: question.completionCriteria?.length ? question.completionCriteria : ["至少一个直接证据"],
      sourceStrategy: question.sourceStrategy?.length ? question.sourceStrategy : ["优先官方、原始研究或项目资料"],
    }));
  return {
    ...plan,
    ...(decision.scope ? { scope: decision.scope } : {}),
    ...(decision.timeRange !== undefined ? { timeRange: decision.timeRange } : {}),
    ...(decision.sourceStrategy?.length ? { sourceStrategy: decision.sourceStrategy } : {}),
    ...(decision.completionCriteria?.length ? { completionCriteria: decision.completionCriteria } : {}),
    ...(decision.expectedOutputs?.length ? { expectedOutputs: decision.expectedOutputs } : {}),
    researchQuestions: [...questions, ...extraQuestions],
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
