import type { ReportClaimPacket } from "./prompts";

export interface ReportArchitecture {
  thesis: string;
  sections: Array<{ title: string; question: string; claimIds: string[]; comparisonDimensions: string[]; importance: "high" | "medium" | "low" }>;
  uncertainties: string[];
  excludedClaimIds: string[];
}

export interface ReportAuditIssue {
  code: string;
  severity: "error" | "warning";
  message: string;
}

export interface ReportAuditDecision {
  pass: boolean;
  issues: ReportAuditIssue[];
  repairInstructions: string[];
}

function strings(value: unknown, maximum: number, length: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim().slice(0, length)).slice(0, maximum);
}

export function normalizeReportArchitecture(value: unknown, allowedClaimIds: Set<string>): ReportArchitecture | null {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  if (typeof record.thesis !== "string" || !record.thesis.trim() || !Array.isArray(record.sections)) return null;
  const sections = record.sections.flatMap((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const section = raw as Record<string, unknown>;
    if (typeof section.title !== "string" || typeof section.question !== "string") return [];
    const claimIds = strings(section.claimIds, 20, 100).filter((id) => allowedClaimIds.has(id));
    if (claimIds.length === 0) return [];
    return [{
      title: section.title.trim().slice(0, 160),
      question: section.question.trim().slice(0, 500),
      claimIds,
      comparisonDimensions: strings(section.comparisonDimensions, 10, 120),
      importance: section.importance === "high" ? "high" as const : section.importance === "low" ? "low" as const : "medium" as const,
    }];
  }).slice(0, 12);
  if (sections.length === 0) return null;
  return { thesis: record.thesis.trim().slice(0, 2_000), sections, uncertainties: strings(record.uncertainties, 12, 500), excludedClaimIds: strings(record.excludedClaimIds, 100, 100).filter((id) => allowedClaimIds.has(id)) };
}

export function fallbackReportArchitecture(input: { objective: string; intentType?: string; claims: ReportClaimPacket[] }): ReportArchitecture {
  const usable = input.claims.filter((claim) => claim.status !== "unsupported");
  return {
    thesis: usable.length > 0 ? `围绕“${input.objective}”综合当前已核验命题，并按证据强度保留限定。` : `当前证据不足以可靠回答“${input.objective}”。`,
    sections: usable.length > 0 ? [{ title: input.intentType === "comparison" ? "比较与综合判断" : "综合分析", question: input.objective, claimIds: usable.map((claim) => claim.id), comparisonDimensions: [], importance: "high" }] : [],
    uncertainties: usable.filter((claim) => claim.status !== "verified").map((claim) => claim.statement).slice(0, 8),
    excludedClaimIds: input.claims.filter((claim) => claim.status === "unsupported").map((claim) => claim.id),
  };
}

export function normalizeReportAuditDecision(value: unknown): ReportAuditDecision {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const issues: ReportAuditIssue[] = Array.isArray(record.issues) ? record.issues.flatMap((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const issue = raw as Record<string, unknown>;
    if (typeof issue.code !== "string" || typeof issue.message !== "string") return [];
    return [{ code: issue.code.slice(0, 80), severity: issue.severity === "warning" ? "warning" as const : "error" as const, message: issue.message.slice(0, 500) }];
  }).slice(0, 20) : [];
  return { pass: record.pass === true && !issues.some((issue) => issue.severity === "error"), issues, repairInstructions: strings(record.repairInstructions, 12, 500) };
}

export function evidenceMarkersInReport(report: string): number[] {
  return [...report.matchAll(/\[E(\d+)\](?!\()/g)].map((match) => Number(match[1])).filter(Number.isInteger);
}

export function deterministicReportAudit(input: { report: string; evidenceRefs: string[]; claims: ReportClaimPacket[] }): ReportAuditDecision {
  const issues: ReportAuditIssue[] = [];
  const body = input.report.trim();
  if (!body || body.length < 160) issues.push({ code: "empty_or_shallow_report", severity: "error", message: "报告正文为空或明显不足" });
  if (/本次研究围绕[\s\S]{0,120}形成以下可核验结论|以上内容只代表当前 Run/.test(body)) issues.push({ code: "deterministic_fallback_language", severity: "error", message: "报告包含已禁用的流程化 fallback 句式" });
  const nonEmpty = body.split("\n").map((line) => line.trim()).filter(Boolean);
  const bullets = nonEmpty.filter((line) => /^[-*]\s/.test(line)).length;
  if (nonEmpty.length > 0 && bullets / nonEmpty.length > 0.65) issues.push({ code: "bullet_list_report", severity: "error", message: "报告主要由项目符号组成，缺少综合叙述" });
  const allowedMarkers = new Set(input.claims.filter((claim) => claim.status !== "unsupported").flatMap((claim) => claim.evidence.map((item) => Number(item.marker.replace(/^E/, ""))).filter(Number.isInteger)));
  for (const marker of evidenceMarkersInReport(body)) {
    if (marker < 1 || marker > input.evidenceRefs.length) issues.push({ code: "unknown_evidence_marker", severity: "error", message: `报告包含未知引用 E${marker}` });
    else if (!allowedMarkers.has(marker)) issues.push({ code: "unrelated_evidence_marker", severity: "error", message: `引用 E${marker} 不属于任何可进入报告的 Claim 关系` });
  }
  for (const claim of input.claims.filter((item) => item.status === "unsupported")) {
    if (claim.statement.length >= 16 && body.includes(claim.statement)) issues.push({ code: "unsupported_claim_in_body", severity: "error", message: "unsupported Claim 进入了肯定性正文" });
  }
  return { pass: issues.every((issue) => issue.severity !== "error"), issues, repairInstructions: issues.map((issue) => issue.message) };
}

export function mergeReportAudits(deterministic: ReportAuditDecision, model: ReportAuditDecision | null): ReportAuditDecision {
  const issues = [...deterministic.issues, ...(model?.issues ?? [])];
  return { pass: deterministic.pass && Boolean(model?.pass), issues, repairInstructions: [...new Set([...deterministic.repairInstructions, ...(model?.repairInstructions ?? [])])].slice(0, 12) };
}
