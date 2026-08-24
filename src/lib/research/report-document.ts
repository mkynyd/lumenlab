export type ResearchAssertionType = "descriptive" | "comparative" | "generalized" | "causal" | "consensus";

export interface ReportStructureClaim {
  id: string;
  statement: string;
  questionId: string | null;
  questionTitle: string | null;
  evidenceRelations: Array<{ evidenceId: string; sourceSnapshotId: string; relation: string }>;
}

export function classifyResearchAssertion(statement: string): ResearchAssertionType {
  if (/(共识|一致|普遍认为|主流观点|多数研究)/.test(statement)) return "consensus";
  if (/(比较|相比|优于|低于|高于|差异|对照)/.test(statement)) return "comparative";
  if (/(导致|造成|引起|影响|因果|使得|使其)/.test(statement)) return "causal";
  if (/(通常|一般|所有|任何|普遍|必然|显著)/.test(statement)) return "generalized";
  return "descriptive";
}

/**
 * Build the structured, immutable report outline from consolidated Claims.
 * The Markdown body remains the readable rendering, while sections and
 * assertions keep the machine-addressable claim/evidence relationships.
 */
export function buildResearchReportStructure(claims: ReportStructureClaim[]) {
  const grouped = new Map<string, { id: string; title: string; claimRefs: string[]; evidenceIds: string[]; sourceSnapshotIds: string[] }>();
  const assertions = claims.map((claim) => ({
    id: `assertion-${claim.id}`,
    text: claim.statement,
    assertionType: classifyResearchAssertion(claim.statement),
    claimRefs: [claim.id],
    citationRefs: [...new Set(claim.evidenceRelations.flatMap((relation) => relation.sourceSnapshotId ? [relation.sourceSnapshotId] : []))],
    evidenceIds: [...new Set(claim.evidenceRelations.map((relation) => relation.evidenceId))],
  }));
  for (const claim of claims) {
    const groupId = claim.questionId ?? "unassigned";
    const section = grouped.get(groupId) ?? { id: `section-${groupId}`, title: claim.questionTitle ?? "研究结论", claimRefs: [], evidenceIds: [], sourceSnapshotIds: [] };
    section.claimRefs.push(claim.id);
    for (const relation of claim.evidenceRelations) {
      section.evidenceIds.push(relation.evidenceId);
      section.sourceSnapshotIds.push(relation.sourceSnapshotId);
    }
    section.evidenceIds = [...new Set(section.evidenceIds)];
    section.sourceSnapshotIds = [...new Set(section.sourceSnapshotIds)];
    grouped.set(groupId, section);
  }
  return { sections: [...grouped.values()], assertions };
}
