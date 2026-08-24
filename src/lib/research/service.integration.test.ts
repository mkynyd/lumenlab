import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { createResearchRun, createResearchWorkspace, createFollowUpResearchRun } from "./service";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
});

afterAll(async () => {
  await prisma.$disconnect();
  await pool.end();
});

describe("Research follow-up asset inheritance", () => {
  it("copies active snapshots, evidence and claims into new Run-owned records", async () => {
    const suffix = randomUUID();
    const user = await prisma.user.create({ data: { email: `research-follow-up-${suffix}@example.test`, passwordHash: "integration-only" } });
    try {
      const workspace = await createResearchWorkspace({ userId: user.id, name: "Follow-up inheritance fixture" });
      const original = await createResearchRun({ userId: user.id, workspaceId: workspace.id, question: "原始研究问题" });
      await prisma.researchRun.update({ where: { id: original.id }, data: { status: "completed", completedAt: new Date() } });
      const question = await prisma.researchQuestion.findFirstOrThrow({ where: { runId: original.id }, orderBy: { orderIndex: "asc" } });
      const source = await prisma.researchSource.create({ data: { workspaceId: workspace.id, userId: user.id, kind: "web", canonicalKey: `url:https://example.test/${suffix}`, canonicalUrl: `https://example.test/${suffix}`, title: "Fixture source" } });
      const snapshot = await prisma.researchSourceSnapshot.create({ data: { workspaceId: workspace.id, runId: original.id, sourceId: source.id, contentHash: `hash-${suffix}`, rawContentLocation: { provider: "local", key: `fixture/${suffix}.md` }, excerpt: "原始证据摘录" } });
      const evidence = await prisma.evidence.create({ data: { workspaceId: workspace.id, runId: original.id, questionId: question.id, sourceSnapshotId: snapshot.id, statement: "原始证据陈述", locator: { line: 1 }, excerpt: "原始证据摘录", evidenceType: "direct_quote", provenance: { actor: "integration" } } });
      const claim = await prisma.claim.create({ data: { workspaceId: workspace.id, runId: original.id, questionId: question.id, statement: "原始 Claim", quality: { label: "中等" } } });
      await prisma.claimEvidenceRelation.create({ data: { claimId: claim.id, evidenceId: evidence.id, relation: "supports", confidence: 0.8 } });

      const followUp = await createFollowUpResearchRun(user.id, original.id, "需要补充的后续研究问题");
      const inheritedSnapshots = await prisma.researchSourceSnapshot.findMany({ where: { runId: followUp.id } });
      const inheritedEvidence = await prisma.evidence.findMany({ where: { runId: followUp.id } });
      const inheritedClaims = await prisma.claim.findMany({ where: { runId: followUp.id }, include: { evidenceRelations: true } });
      const currentOriginal = await prisma.evidence.findUniqueOrThrow({ where: { id: evidence.id } });

      expect(followUp.followUpOfId).toBe(original.id);
      expect(inheritedSnapshots).toHaveLength(1);
      expect(inheritedSnapshots[0]).toMatchObject({ sourceId: source.id, contentHash: snapshot.contentHash });
      expect(inheritedSnapshots[0].id).not.toBe(snapshot.id);
      expect(inheritedEvidence).toHaveLength(1);
      expect(inheritedEvidence[0]).toMatchObject({ statement: evidence.statement, sourceSnapshotId: inheritedSnapshots[0].id, questionId: expect.any(String), provenance: { actor: "follow_up_inheritance", inheritedFromRunId: original.id, inheritedFromEvidenceId: evidence.id } });
      expect(inheritedEvidence[0].id).not.toBe(evidence.id);
      expect(inheritedClaims).toHaveLength(1);
      expect(inheritedClaims[0]).toMatchObject({ statement: claim.statement, verificationStatus: "pending", questionId: expect.any(String), quality: { inheritedFromRunId: original.id } });
      expect(inheritedClaims[0].evidenceRelations).toEqual([expect.objectContaining({ evidenceId: inheritedEvidence[0].id, relation: "supports" })]);
      expect(currentOriginal).toMatchObject({ status: "active", statement: evidence.statement, sourceSnapshotId: snapshot.id });
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});
