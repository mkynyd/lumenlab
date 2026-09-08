import type { ResearchEvidenceType } from "@/generated/prisma/client";

export const USER_EDITABLE_EVIDENCE_STATUSES = ["disputed", "invalidated"] as const;
export type UserEditableEvidenceStatus = (typeof USER_EDITABLE_EVIDENCE_STATUSES)[number];

export function normalizeEvidenceTags(tags: readonly string[] | undefined): string[] {
  return [...new Set((tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean))].slice(0, 24);
}

export function assertEvidenceRevisionInput(input: {
  statement: string;
  excerpt: string;
  evidenceType: ResearchEvidenceType;
}): void {
  if (input.statement.trim().length < 3) throw new Error("Evidence statement 至少需要 3 个字符");
  if (input.excerpt.trim().length < 3) throw new Error("Evidence excerpt 至少需要 3 个字符");
  if (!input.evidenceType) throw new Error("Evidence type 不能为空");
}

export function isUserEditableEvidenceStatus(value: string): value is UserEditableEvidenceStatus {
  return USER_EDITABLE_EVIDENCE_STATUSES.includes(value as UserEditableEvidenceStatus);
}
