import { beforeEach, describe, expect, it, vi } from "vitest";
import { computeDeterministicClaimVerification, mergeClaimVerification, persistExtractedClaimsForQuestion } from "./claim-graph";
import { buildClaimKey } from "./claim-extraction";

function relation(type: string, sourceId: string, status = "active") {
  return { relation: type, evidence: { status, sourceSnapshot: { sourceId } } };
}

describe("claim graph · deterministic verification floor", () => {
  it("marks claims without any valid support as unsupported", () => {
    expect(computeDeterministicClaimVerification([])).toMatchObject({ status: "unsupported", reasonCode: "no_support" });
    expect(computeDeterministicClaimVerification([relation("context", "s1")])).toMatchObject({ status: "unsupported", reasonCode: "no_support" });
  });

  it("does not verify claims backed only by qualifies relations", () => {
    const result = computeDeterministicClaimVerification([relation("qualifies", "s1"), relation("context", "s2")]);
    expect(result).toMatchObject({ status: "needs_qualification", reasonCode: "indirect_support" });
  });

  it("marks supports+contradicts as conflicted without model involvement", () => {
    expect(computeDeterministicClaimVerification([relation("supports", "s1"), relation("contradicts", "s2")])).toMatchObject({ status: "conflicted", reasonCode: "mixed_evidence" });
    expect(computeDeterministicClaimVerification([relation("contradicts", "s1")])).toMatchObject({ status: "conflicted", reasonCode: "contradicted" });
  });

  it("counts multiple chunks from the same canonical source as one independent source", () => {
    const single = computeDeterministicClaimVerification([relation("supports", "s1"), relation("supports", "s1"), relation("supports", "s1")]);
    expect(single).toMatchObject({ status: "verified", reasonCode: "single_source_only" });
    expect(single.quality).toMatchObject({ evidenceCount: 3, uniqueSourceCount: 1, directSupportCount: 3 });
    const multiple = computeDeterministicClaimVerification([relation("supports", "s1"), relation("supports", "s2")]);
    expect(multiple).toMatchObject({ status: "verified", reasonCode: "sufficient_support" });
    expect(multiple.quality.uniqueSourceCount).toBe(2);
  });

  it("excludes superseded and invalidated evidence from support", () => {
    expect(computeDeterministicClaimVerification([relation("supports", "s1", "superseded")])).toMatchObject({ status: "unsupported" });
    expect(computeDeterministicClaimVerification([relation("supports", "s1", "invalidated")])).toMatchObject({ status: "unsupported" });
  });

  it("routes claims with disputed evidence back to re-evaluation", () => {
    const result = computeDeterministicClaimVerification([relation("supports", "s1"), relation("supports", "s2", "disputed")]);
    expect(result).toMatchObject({ status: "needs_qualification", reasonCode: "invalid_evidence" });
    expect(result.quality.disputedEvidenceCount).toBe(1);
  });
});

describe("claim graph · model merge ceiling", () => {
  const verified = computeDeterministicClaimVerification([relation("supports", "s1")]);
  const unsupported = computeDeterministicClaimVerification([]);

  it("never lets the model upgrade an unsupported claim", () => {
    expect(mergeClaimVerification({ deterministic: unsupported, model: { status: "verified", reasonCode: "sufficient_support" } }))
      .toEqual({ status: "unsupported", reasonCode: "no_support" });
  });

  it("lets the model confirm or downgrade within the deterministic ceiling", () => {
    expect(mergeClaimVerification({ deterministic: verified, model: { status: "verified", reasonCode: "sufficient_support" } }))
      .toEqual({ status: "verified", reasonCode: "sufficient_support" });
    expect(mergeClaimVerification({ deterministic: verified, model: { status: "needs_qualification", reasonCode: "scope_mismatch" } }))
      .toEqual({ status: "needs_qualification", reasonCode: "scope_mismatch" });
    expect(mergeClaimVerification({ deterministic: verified, model: { status: "unsupported", reasonCode: "indirect_support" } }))
      .toEqual({ status: "unsupported", reasonCode: "indirect_support" });
  });

  it("keeps the deterministic status when the model is unavailable", () => {
    expect(mergeClaimVerification({ deterministic: verified, model: null })).toEqual({ status: "verified", reasonCode: "single_source_only" });
  });
});

// ---------- persistence ----------

const db = {
  claims: [] as Array<Record<string, unknown>>,
  relations: [] as Array<Record<string, unknown>>,
};

let idCounter = 0;
function nextId(prefix: string) {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      claim: {
        findMany: vi.fn(async ({ where }: { where: { runId: string; questionId: string; claimKey: { not: null } } }) =>
          db.claims.filter((row) => row.runId === where.runId && row.questionId === where.questionId && row.claimKey != null)
            .map((row) => ({
              ...row,
              evidenceRelations: db.relations
                .filter((relation) => relation.claimId === row.id)
                .map((relation) => ({ evidenceId: relation.evidenceId, evidence: { status: (relation.evidenceStatus as string) ?? "active" } })),
            }))),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const row = { ...data, id: nextId("claim"), userEdited: false, status: data.status ?? "active" };
          db.claims.push(row);
          return row;
        }),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = db.claims.find((item) => item.id === where.id);
          if (row) Object.assign(row, data);
          return row;
        }),
      },
      claimEvidenceRelation: {
        upsert: vi.fn(async ({ where, create, update }: { where: { claimId_evidenceId: { claimId: string; evidenceId: string } }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
          const existing = db.relations.find((relation) => relation.claimId === where.claimId_evidenceId.claimId && relation.evidenceId === where.claimId_evidenceId.evidenceId);
          if (existing) {
            Object.assign(existing, update);
            return existing;
          }
          const row = { ...create };
          db.relations.push(row);
          return row;
        }),
      },
    })),
  },
}));

beforeEach(() => {
  db.claims = [];
  db.relations = [];
  vi.clearAllMocks();
});

const QUESTION = { id: "q-1", key: "q1" };
const SOURCES = new Map([["ev-1", "src-1"], ["ev-2", "src-2"]]);

function input(claims: Array<{ key: string; statement: string; qualifiers?: string[]; relations: Array<{ evidenceId: string; relation: "supports" | "contradicts" | "qualifies" | "context"; confidence: number; rationale: string | null }> }>) {
  return { workspaceId: "ws-1", runId: "run-1", question: QUESTION, claims: claims.map((claim) => ({ qualifiers: [], ...claim })), evidenceSourceById: SOURCES };
}

describe("claim graph · persistence", () => {
  it("creates claims with deterministic claimKey and relations with confidence/rationale", async () => {
    const result = await persistExtractedClaimsForQuestion(input([
      { key: "self-attention", statement: "自注意力取代循环结构", relations: [{ evidenceId: "ev-1", relation: "supports", confidence: 0.9, rationale: "原文直接陈述" }] },
    ]));

    expect(result).toMatchObject({ created: 1, updated: 0, superseded: 0, skippedUserEdited: 0 });
    expect(db.claims[0].claimKey).toBe(buildClaimKey("q1", "self-attention"));
    expect(db.relations[0]).toMatchObject({ evidenceId: "ev-1", relation: "supports", confidence: 0.9, rationale: "原文直接陈述" });
  });

  it("is idempotent across durable reruns with the same extractor output", async () => {
    const output = [
      { key: "self-attention", statement: "自注意力取代循环结构", relations: [{ evidenceId: "ev-1", relation: "supports" as const, confidence: 0.9, rationale: "r" }] },
    ];
    await persistExtractedClaimsForQuestion(input(output));
    const second = await persistExtractedClaimsForQuestion(input(output));

    expect(second).toMatchObject({ created: 0, updated: 1 });
    expect(db.claims).toHaveLength(1);
    expect(db.relations).toHaveLength(1);
  });

  it("never touches user-edited claims", async () => {
    await persistExtractedClaimsForQuestion(input([
      { key: "k", statement: "系统命题", relations: [{ evidenceId: "ev-1", relation: "supports", confidence: 0.8, rationale: null }] },
    ]));
    db.claims[0].userEdited = true;
    db.claims[0].statement = "用户改写后的命题";

    const result = await persistExtractedClaimsForQuestion(input([
      { key: "k", statement: "系统新命题", relations: [{ evidenceId: "ev-2", relation: "supports", confidence: 0.7, rationale: null }] },
    ]));

    expect(result.skippedUserEdited).toBe(1);
    expect(db.claims[0].statement).toBe("用户改写后的命题");
    expect(db.relations).toHaveLength(1);
  });

  it("supersedes stale system claims that lost all active evidence basis", async () => {
    await persistExtractedClaimsForQuestion(input([
      { key: "old-claim", statement: "旧命题", relations: [{ evidenceId: "ev-1", relation: "supports", confidence: 0.8, rationale: null }] },
    ]));
    // 模拟 Evidence 被 invalidated：relation 仍在，但 evidence status 变化
    db.relations[0].evidenceStatus = "invalidated";

    const result = await persistExtractedClaimsForQuestion(input([
      { key: "new-claim", statement: "新命题", relations: [{ evidenceId: "ev-2", relation: "supports", confidence: 0.8, rationale: null }] },
    ]));

    expect(result.superseded).toBe(1);
    const stale = db.claims.find((claim) => claim.claimKey === buildClaimKey("q1", "old-claim"));
    expect(stale?.status).toBe("superseded");
  });

  it("keeps stale claims that still have an active evidence basis", async () => {
    await persistExtractedClaimsForQuestion(input([
      { key: "old-claim", statement: "旧命题", relations: [{ evidenceId: "ev-1", relation: "supports", confidence: 0.8, rationale: null }] },
    ]));

    const result = await persistExtractedClaimsForQuestion(input([
      { key: "new-claim", statement: "新命题", relations: [{ evidenceId: "ev-2", relation: "supports", confidence: 0.8, rationale: null }] },
    ]));

    expect(result.superseded).toBe(0);
    expect(db.claims.every((claim) => claim.status === "active")).toBe(true);
  });

  it("supersedes system claims when the question evidence set becomes empty", async () => {
    await persistExtractedClaimsForQuestion(input([
      { key: "old-claim", statement: "旧命题", relations: [{ evidenceId: "ev-1", relation: "supports", confidence: 0.8, rationale: null }] },
    ]));
    db.relations[0].evidenceStatus = "invalidated";

    const result = await persistExtractedClaimsForQuestion(input([]));

    expect(result).toMatchObject({ created: 0, superseded: 1 });
  });
});
