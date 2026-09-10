import { prisma } from "@/lib/db";
import { buildClaimKey, CLAIM_EXTRACTOR_VERSION, type NormalizedExtractedClaim } from "./claim-extraction";

/**
 * Deep Research Claim Graph v1 — Claim/Relation 持久化与 deterministic 核验下界。
 * 模型只负责提出候选 Claim 与 relation；能否 verified 由这里的证据结构下界
 * 与 research.verifier 的进一步降级共同决定。
 */

function json(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}

export type ClaimVerificationStatus = "verified" | "needs_qualification" | "unsupported" | "conflicted";

export interface ClaimRelationEvidenceShape {
  relation: string;
  evidence: {
    status: string;
    sourceSnapshot: { sourceId: string };
    /**
     * Evidence 类型（可选）。用于区分「原论文直接陈述」与「模型从图表得出的
     * 受约束观察」：visual_observation 是 derived observation，本身不能把
     * Claim 抬到 verified。缺失时按直接证据处理，保持历史行为。
     */
    evidenceType?: string;
    /**
     * Snapshot 读取范围（可选）：metadata_only 表示只读到摘要级元数据，
     * 没有读到正文，因此不能单独把 Claim 抬到 verified。
     */
    snapshotScopeType?: string | null;
  };
}

/** 从 ResearchSourceSnapshot.metadata.scope.type 读取读取范围。 */
export function snapshotScopeTypeOf(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const scope = (metadata as Record<string, unknown>).scope;
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) return null;
  const type = (scope as Record<string, unknown>).type;
  return typeof type === "string" ? type : null;
}

export interface ClaimQualitySummary {
  evidenceCount: number;
  uniqueSourceCount: number;
  directSupportCount: number;
  contradictionCount: number;
  qualificationCount: number;
  contextCount: number;
  disputedEvidenceCount: number;
  sourceDiversity: number;
  /** supports 中属于 visual_observation（模型读图）的数量。 */
  visualObservationSupportCount: number;
  /** supports 中只读到摘要级元数据（没有正文）的数量。 */
  metadataOnlySupportCount: number;
}

export interface DeterministicClaimVerification {
  status: ClaimVerificationStatus;
  reasonCode: string;
  quality: ClaimQualitySummary;
}

/**
 * Verifier 前的 deterministic 安全下界：
 * - superseded/invalidated Evidence 不再是有效依据；disputed Evidence 使 Claim 进入重新评估；
 * - 没有任何有效 supports/qualifies（含只有 context）不能 verified；
 * - supports 与 contradicts 并存至少进入 conflicted；
 * - 仅 qualifies 不能以原始强措辞 verified；
 * - 独立来源按 canonical ResearchSource 去重，同一论文的多个 chunk 只算一个来源；
 * - 只有 visual_observation（模型读图得出的 derived observation）支撑时，Claim
 *   最多 needs_qualification：模型对图表的解释不等于原论文的直接陈述；
 * - 只有 metadata_only（只读到摘要级元数据、没有正文）来源支撑时，Claim 同样
 *   最多 needs_qualification。
 */
export function computeDeterministicClaimVerification(relations: ClaimRelationEvidenceShape[]): DeterministicClaimVerification {
  const valid = relations.filter((relation) => relation.evidence.status === "active");
  const disputedEvidenceCount = relations.filter((relation) => relation.evidence.status === "disputed").length;
  const count = (type: string) => valid.filter((relation) => relation.relation === type).length;
  const directSupportCount = count("supports");
  const contradictionCount = count("contradicts");
  const qualificationCount = count("qualifies");
  const contextCount = count("context");
  const visualObservationSupportCount = valid.filter(
    (relation) => relation.relation === "supports" && relation.evidence.evidenceType === "visual_observation"
  ).length;
  const metadataOnlySupportCount = valid.filter(
    (relation) => relation.relation === "supports" && relation.evidence.snapshotScopeType === "metadata_only"
  ).length;
  const uniqueSourceCount = new Set(valid.map((relation) => relation.evidence.sourceSnapshot.sourceId)).size;
  const quality: ClaimQualitySummary = {
    evidenceCount: valid.length,
    uniqueSourceCount,
    directSupportCount,
    contradictionCount,
    qualificationCount,
    contextCount,
    disputedEvidenceCount,
    sourceDiversity: Math.min(1, uniqueSourceCount / 2),
    visualObservationSupportCount,
    metadataOnlySupportCount,
  };

  if (directSupportCount > 0 && contradictionCount > 0) {
    return { status: "conflicted", reasonCode: "mixed_evidence", quality };
  }
  if (directSupportCount > 0) {
    if (disputedEvidenceCount > 0) {
      return { status: "needs_qualification", reasonCode: "invalid_evidence", quality };
    }
    if (visualObservationSupportCount === directSupportCount) {
      // 支撑全部来自模型读图：保留为可追溯的限定结论。
      return { status: "needs_qualification", reasonCode: "indirect_support", quality };
    }
    if (metadataOnlySupportCount === directSupportCount) {
      // 支撑全部来自只读到摘要级元数据的来源：不能当作正文事实 citation。
      return { status: "needs_qualification", reasonCode: "indirect_support", quality };
    }
    return {
      status: "verified",
      reasonCode: uniqueSourceCount >= 2 ? "sufficient_support" : "single_source_only",
      quality,
    };
  }
  if (contradictionCount > 0) {
    return { status: "conflicted", reasonCode: "contradicted", quality };
  }
  if (qualificationCount > 0) {
    return { status: "needs_qualification", reasonCode: "indirect_support", quality };
  }
  return { status: "unsupported", reasonCode: "no_support", quality };
}

/**
 * model verifier 只能在 deterministic 下界之内调整：不允许把 unsupported/conflicted
 * 升级成 verified，也不允许把 needs_qualification 升级成 verified。
 */
const STATUS_RANK: Record<ClaimVerificationStatus, number> = {
  unsupported: 0,
  conflicted: 1,
  needs_qualification: 2,
  verified: 3,
};

export function mergeClaimVerification(input: {
  deterministic: DeterministicClaimVerification;
  model: { status: ClaimVerificationStatus; reasonCode: string } | null | undefined;
}): { status: ClaimVerificationStatus; reasonCode: string } {
  const model = input.model;
  if (model && STATUS_RANK[model.status] <= STATUS_RANK[input.deterministic.status]) {
    return { status: model.status, reasonCode: model.reasonCode };
  }
  return { status: input.deterministic.status, reasonCode: input.deterministic.reasonCode };
}

export interface PersistExtractedClaimsResult {
  created: number;
  updated: number;
  superseded: number;
  skippedUserEdited: number;
}

/**
 * 一个 Question 的 system Claim + ClaimEvidenceRelation 在单个 transaction 内落库。
 * - claimKey upsert 保证 durable retry / lease 恢复不重复建 Claim；
 * - userEdited=true 的 Claim 完全不动；
 * - 未被本轮输出覆盖、且已不再有任何 active Evidence 依据的 system Claim 进入
 *   superseded 生命周期，绝不物理删除；
 * - relation 只 upsert（relation/confidence/rationale），不删除用户手工关系。
 */
export async function persistExtractedClaimsForQuestion(input: {
  workspaceId: string;
  runId: string;
  question: { id: string; key: string };
  claims: NormalizedExtractedClaim[];
  /** evidenceId → canonical ResearchSource id（仅当前 active Evidence）。 */
  evidenceSourceById: ReadonlyMap<string, string>;
}): Promise<PersistExtractedClaimsResult> {
  const result: PersistExtractedClaimsResult = { created: 0, updated: 0, superseded: 0, skippedUserEdited: 0 };
  const outputKeys = new Set(input.claims.map((claim) => buildClaimKey(input.question.key, claim.key)));

  await prisma.$transaction(async (tx) => {
    const existing = await tx.claim.findMany({
      where: { runId: input.runId, questionId: input.question.id, claimKey: { not: null } },
      include: { evidenceRelations: { select: { evidenceId: true, evidence: { select: { status: true } } } } },
    });
    const byClaimKey = new Map(existing.map((claim) => [claim.claimKey as string, claim]));

    for (const extracted of input.claims) {
      const claimKey = buildClaimKey(input.question.key, extracted.key);
      const current = byClaimKey.get(claimKey);
      if (current?.userEdited) {
        result.skippedUserEdited += 1;
        continue;
      }
      const qualityBase = {
        extractor: CLAIM_EXTRACTOR_VERSION,
        qualifiers: extracted.qualifiers,
      };
      const claim = current
        ? await tx.claim.update({
            where: { id: current.id },
            data: { statement: extracted.statement, status: "active", quality: json(qualityBase) },
          })
        : await tx.claim.create({
            data: {
              workspaceId: input.workspaceId,
              runId: input.runId,
              questionId: input.question.id,
              statement: extracted.statement,
              claimKey,
              quality: json(qualityBase),
            },
          });
      if (current) result.updated += 1;
      else result.created += 1;

      for (const relation of extracted.relations) {
        if (!input.evidenceSourceById.has(relation.evidenceId)) continue;
        await tx.claimEvidenceRelation.upsert({
          where: { claimId_evidenceId: { claimId: claim.id, evidenceId: relation.evidenceId } },
          create: { claimId: claim.id, evidenceId: relation.evidenceId, relation: relation.relation, confidence: relation.confidence, rationale: relation.rationale },
          update: { relation: relation.relation, confidence: relation.confidence, rationale: relation.rationale },
        });
      }
    }

    for (const stale of existing) {
      if (stale.userEdited || stale.status !== "active") continue;
      if (outputKeys.has(stale.claimKey as string)) continue;
      const hasActiveBasis = stale.evidenceRelations.some((relation) => relation.evidence.status === "active");
      if (hasActiveBasis) continue;
      await tx.claim.update({ where: { id: stale.id }, data: { status: "superseded" } });
      result.superseded += 1;
    }
  });
  return result;
}
