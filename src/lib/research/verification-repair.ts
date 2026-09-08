export type VerificationRepairStatus = "verified" | "needs_qualification" | "unsupported" | "conflicted";
type VerificationRepairPriority = "critical" | "important" | "supporting";

interface VerificationRepairQuestion {
  id: string;
  title: string;
  question: string;
  priority: VerificationRepairPriority;
}

export interface VerificationRepairClaim {
  id: string;
  questionId: string | null;
  question: VerificationRepairQuestion | null;
}

export interface VerificationRepairTarget {
  questionId: string;
  title: string;
  question: string;
  priority: VerificationRepairPriority;
  claimIds: string[];
  statuses: Array<Extract<VerificationRepairStatus, "unsupported" | "conflicted">>;
}

const PRIORITY_ORDER = { critical: 0, important: 1, supporting: 2 } as const;

/**
 * Collapse multiple failed Claims from the same Research Question into one
 * bounded follow-up task. The question priority is preserved so critical gaps
 * are scheduled first when the repair budget is scarce.
 */
export function selectVerificationRepairTargets(input: {
  claims: VerificationRepairClaim[];
  statuses: Record<string, { status: VerificationRepairStatus }>;
  maximum: number;
}): VerificationRepairTarget[] {
  const targets = new Map<string, VerificationRepairTarget>();
  for (const claim of input.claims) {
    const status = input.statuses[claim.id]?.status;
    if ((status !== "unsupported" && status !== "conflicted") || !claim.question) continue;
    const existing = targets.get(claim.question.id);
    if (existing) {
      existing.claimIds.push(claim.id);
      if (!existing.statuses.includes(status)) existing.statuses.push(status);
      continue;
    }
    targets.set(claim.question.id, {
      questionId: claim.question.id,
      title: claim.question.title,
      question: claim.question.question,
      priority: claim.question.priority,
      claimIds: [claim.id],
      statuses: [status],
    });
  }
  return [...targets.values()]
    .sort((left, right) => PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority])
    .slice(0, Math.max(0, input.maximum));
}

export function verificationRepairInstruction(target: VerificationRepairTarget) {
  const issue = target.statuses.map((status) => status === "unsupported" ? "缺少直接支持" : "存在冲突或反证").join("、");
  return `围绕研究问题“${target.question}”补充独立来源，重点修复：${issue}。仅返回当前问题所需的可核验证据，不要扩大研究范围。`;
}

export function appendVerificationQualification(input: {
  draft: string;
  unsupportedClaims: number;
  conflictedClaims: number;
  qualifiedClaims: number;
}) {
  const lines = [
    input.unsupportedClaims > 0 ? `- ${input.unsupportedClaims} 条 Claim 缺少当前 Run 中可直接支持的 Evidence。` : null,
    input.conflictedClaims > 0 ? `- ${input.conflictedClaims} 条 Claim 存在相互冲突或反驳证据，结论应视为有争议。` : null,
    input.qualifiedClaims > 0 ? `- ${input.qualifiedClaims} 条 Claim 需要限定适用范围、日期或因果措辞。` : null,
  ].filter((line): line is string => Boolean(line));
  if (lines.length === 0) return input.draft;
  return `${input.draft.trim()}\n\n## 引用核验限制\n\n${lines.join("\n")}\n\n本节记录当前快照的核验边界；后续补充或纠正应创建新的 Follow-up Research Run。`;
}
