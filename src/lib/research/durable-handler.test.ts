import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentCheckpoint } from "@/lib/agent/executions/agent-execution-store";
import type { AgentExecutionHandlerContext } from "@/lib/agent/executions/agent-execution-runner";
import type { ReadResearchSource, ResearchCandidate, ResearchSourceProvider } from "./source-provider";
import { buildQuestionEvidenceFingerprint } from "./claim-extraction";

const state = {
  candidates: [] as Array<{ id: string; runId: string; provider: string; externalId: string; status: string; researchSourceId: string | null }>,
  sources: [] as Array<{ id: string; workspaceId: string; canonicalKey: string }>,
  snapshots: [] as Array<{ id: string; runId: string; sourceId: string; contentHash: string }>,
  evidences: [] as Array<{ id: string; runId: string; evidenceKey: string | null; locator: unknown }>,
  claims: [] as Array<Record<string, unknown>>,
  relations: [] as Array<Record<string, unknown>>,
  claimUpdates: [] as Array<{ id: string; data: Record<string, unknown> }>,
  report: null as Record<string, unknown> | null,
  savedCheckpoints: [] as AgentCheckpoint[],
};

let runStatus = "researching";

const stageBehavior: {
  claimExtractor: unknown;
  synthesizer: string | null;
  verifier: unknown;
} = {
  claimExtractor: null,
  synthesizer: null,
  verifier: null,
};

let idCounter = 0;
function nextId(prefix: string) {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

const researchRunRow = {
  id: "run-1",
  userId: "user-1",
  workspaceId: "ws-1",
  status: "researching",
  question: "Transformer 架构的核心创新是什么？",
  startedAt: new Date(),
  createdAt: new Date(),
  modelConfiguration: null,
  workspace: { id: "ws-1", budgetProfile: "quick", projectId: null },
  activePlanVersion: { id: "plan-1", plan: {} },
};

const taskRow = {
  id: "task-1",
  runId: "run-1",
  questionId: "q-1",
  attempt: 0,
  maxAttempts: 3,
  instructions: null,
  priority: "important",
  question: {
    id: "q-1",
    title: "核心创新",
    question: "Transformer 的自注意力机制如何工作？",
    priority: "important",
    researchAttempts: 0,
  },
};

const SOURCE_ROW = {
  id: "src-1",
  canonicalKey: "doi:10.48550/arxiv.1706.03762",
  title: "Attention Is All You Need",
  kind: "academic_paper",
  doi: "10.48550/arxiv.1706.03762",
  canonicalUrl: "https://doi.org/10.48550/arxiv.1706.03762",
};

function evidenceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "ev-1",
    runId: "run-1",
    questionId: "q-1",
    status: "active",
    statement: "The Transformer uses self-attention.",
    excerpt: "The Transformer uses self-attention.",
    evidenceType: "direct_quote",
    locator: { kind: "sciverse", docId: "d".repeat(64), chunkId: "chunk-1", offset: 1200 },
    provenance: { provider: "sciverse", retrievalMethod: "sciverse.read" },
    sourceSnapshotId: "snap-1",
    sourceSnapshot: { sourceId: "src-1", metadata: { provider: "sciverse" }, retrievedAt: new Date(), source: { ...SOURCE_ROW } },
    ...overrides,
  };
}

const questionRow = {
  id: "q-1",
  key: "q1",
  runId: "run-1",
  title: "核心创新",
  question: "Transformer 的自注意力机制如何工作？",
  priority: "important",
  orderIndex: 0,
  completionCriteria: [],
  evaluateAttempts: 0,
  replanAttempts: 0,
  evidence: [] as Array<Record<string, unknown>>,
};

const txMock = {
  claim: {
    findMany: vi.fn(async ({ where }: { where: { runId: string; questionId: string } }) =>
      state.claims
        .filter((row) => row.runId === where.runId && row.questionId === where.questionId && row.claimKey != null)
        .map((row) => ({
          ...row,
          evidenceRelations: state.relations
            .filter((relation) => relation.claimId === row.id)
            .map((relation) => ({ evidenceId: relation.evidenceId, evidence: { status: (relation.evidenceStatus as string) ?? "active" } })),
        }))),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = { ...data, id: nextId("claim"), userEdited: false, status: (data.status as string) ?? "active", quality: data.quality ?? null };
      state.claims.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = state.claims.find((item) => item.id === where.id);
      if (row) Object.assign(row, data);
      return row;
    }),
  },
  claimEvidenceRelation: {
    upsert: vi.fn(async ({ where, create, update }: { where: { claimId_evidenceId: { claimId: string; evidenceId: string } }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
      const existing = state.relations.find((relation) => relation.claimId === where.claimId_evidenceId.claimId && relation.evidenceId === where.claimId_evidenceId.evidenceId);
      if (existing) {
        Object.assign(existing, update);
        return existing;
      }
      const row = { ...create };
      state.relations.push(row);
      return row;
    }),
  },
};

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(txMock)),
    researchRun: {
      findFirst: vi.fn(async () => ({ ...researchRunRow, status: runStatus })),
      findUnique: vi.fn(async () => ({ status: runStatus })),
      update: vi.fn(async () => ({})),
    },
    researchTask: {
      updateMany: vi.fn(async () => ({ count: 0 })),
      findMany: vi.fn(async () => [{ ...taskRow, question: { ...taskRow.question } }]),
      update: vi.fn(async () => ({})),
      count: vi.fn(async () => 0),
      create: vi.fn(async () => ({})),
      createMany: vi.fn(async () => ({ count: 0 })),
    },
    researchQuestion: {
      update: vi.fn(async () => ({})),
      findMany: vi.fn(async () => [{ ...questionRow, evidence: questionRow.evidence.map((row) => ({ ...row })) }]),
    },
    researchUserDirective: {
      findMany: vi.fn(async () => []),
    },
    researchSourceCandidate: {
      findFirst: vi.fn(async ({ where }: { where: { runId: string; provider: string; externalId: string } }) =>
        state.candidates.find((row) => row.runId === where.runId && row.provider === where.provider && row.externalId === where.externalId) ?? null),
      create: vi.fn(async ({ data }: { data: { runId: string; provider: string; externalId: string; status: string } }) => {
        const row = { ...data, id: nextId("cand"), researchSourceId: null };
        state.candidates.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { status: string; researchSourceId?: string } }) => {
        const row = state.candidates.find((item) => item.id === where.id);
        if (row) Object.assign(row, data);
        return row;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; status?: { not: string } }; data: { status: string } }) => {
        const row = state.candidates.find((item) => item.id === where.id);
        if (row && row.status !== where.status?.not) row.status = data.status;
        return { count: 1 };
      }),
    },
    researchSource: {
      findUnique: vi.fn(async ({ where }: { where: { workspaceId_canonicalKey: { workspaceId: string; canonicalKey: string } } }) =>
        state.sources.find((row) => row.workspaceId === where.workspaceId_canonicalKey.workspaceId && row.canonicalKey === where.workspaceId_canonicalKey.canonicalKey) ?? null),
      create: vi.fn(async ({ data }: { data: { workspaceId: string; canonicalKey: string } }) => {
        const row = { ...data, id: nextId("source") };
        state.sources.push(row);
        return row;
      }),
      update: vi.fn(async ({ where }: { where: { id: string } }) => state.sources.find((row) => row.id === where.id) ?? {}),
    },
    researchSourceSnapshot: {
      findFirst: vi.fn(async ({ where }: { where: { runId: string; sourceId: string; contentHash: string } }) =>
        state.snapshots.find((row) => row.runId === where.runId && row.sourceId === where.sourceId && row.contentHash === where.contentHash) ?? null),
      create: vi.fn(async ({ data }: { data: { runId: string; sourceId: string; contentHash: string } }) => {
        const row = { ...data, id: nextId("snapshot") };
        state.snapshots.push(row);
        return row;
      }),
    },
    evidence: {
      upsert: vi.fn(async ({ where, create }: { where: { runId_evidenceKey: { runId: string; evidenceKey: string } }; create: { runId: string; evidenceKey: string; locator: unknown } }) => {
        const existing = state.evidences.find((row) => row.runId === where.runId_evidenceKey.runId && row.evidenceKey === where.runId_evidenceKey.evidenceKey);
        if (existing) return existing;
        const row = { ...create, id: nextId("evidence") };
        state.evidences.push(row);
        return row;
      }),
      findMany: vi.fn(async () => questionRow.evidence.map((row) => ({ ...row }))),
    },
    claim: {
      findMany: vi.fn(async () =>
        state.claims
          .filter((row) => row.status === "active" || row.status === "disputed")
          .map((row) => ({
            ...row,
            question: { id: "q-1", title: "核心创新", question: "Transformer 的自注意力机制如何工作？", priority: "important" },
            evidenceRelations: state.relations
              .filter((relation) => relation.claimId === row.id)
              .map((relation) => ({
                ...relation,
                evidence: relation.evidence ?? evidenceRow({ id: relation.evidenceId as string, status: (relation.evidenceStatus as string) ?? "active" }),
              })),
          }))),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        state.claimUpdates.push({ id: where.id, data });
        const row = state.claims.find((item) => item.id === where.id);
        if (row) Object.assign(row, data);
        return row;
      }),
    },
    researchReportSnapshot: {
      findUnique: vi.fn(async () => state.report),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.report = { ...data, id: nextId("report") };
        return state.report;
      }),
    },
  },
}));

vi.mock("@/lib/storage/object-storage", () => ({
  uploadObjectBuffer: vi.fn(async ({ key }: { key: string }) => ({ provider: "qiniu", key })),
}));

vi.mock("./model-stage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./model-stage")>();
  return {
    ...actual,
    runResearchModelStage: vi.fn(async (input: { role: string }) => {
      if (input.role === "research.worker") return { value: { queries: ["transformer self-attention"], rationale: "test" }, usage: null, model: "deepseek-flash", attempted: false };
      if (input.role === "research.claim_extractor") return { value: stageBehavior.claimExtractor, usage: null, model: "deepseek-flash", attempted: true };
      if (input.role === "research.synthesizer") return { value: stageBehavior.synthesizer, usage: null, model: "deepseek-flash", attempted: stageBehavior.synthesizer !== null };
      if (input.role === "research.verifier") return { value: stageBehavior.verifier, usage: null, model: "deepseek-flash", attempted: true };
      return { value: null, usage: null, model: "deepseek-flash", attempted: false };
    }),
  };
});

import { createDurableResearchExecutionHandler } from "./durable-handler";
import { runResearchModelStage } from "./model-stage";

const sciverseCandidate: ResearchCandidate = {
  provider: "sciverse",
  kind: "academic_paper",
  externalId: "10.48550/arxiv.1706.03762",
  title: "Attention Is All You Need",
  url: "https://arxiv.org/abs/1706.03762",
  metadata: { doi: "10.48550/arxiv.1706.03762", docId: "d".repeat(64), uniqueId: "paper:1", isContentAccessible: true },
};

const sciverseRead: ReadResearchSource = {
  candidate: sciverseCandidate,
  title: "Attention Is All You Need",
  content: "The Transformer uses self-attention.",
  excerpt: "The Transformer uses self-attention.",
  locator: { kind: "sciverse", docId: "d".repeat(64), chunkId: "chunk-1", offset: 1200 },
  sourceVersion: "2017",
  metadata: { provider: "sciverse", citationCount: 100000 },
  evidenceType: "direct_quote",
  slices: [{
    excerpt: "The Transformer uses self-attention.",
    locator: { kind: "sciverse", docId: "d".repeat(64), chunkId: "chunk-1", offset: 1200 },
    provenance: { provider: "sciverse", retrievalMethod: "sciverse.read", semanticScore: 0.83 },
  }],
  snapshotScope: { type: "bounded_evidence_slices", provider: "sciverse", docId: "d".repeat(64) },
};

function createContext(options: { researchState?: Record<string, unknown> } = {}): AgentExecutionHandlerContext {
  const checkpoint = {
    request: { executionKind: "research", researchRunId: "run-1" },
    ...(options.researchState ? { researchState: options.researchState } : {}),
  } as unknown as AgentCheckpoint;
  return {
    execution: {
      id: "exec-1",
      userId: "user-1",
      conversationId: "conv-1",
      attempt: 1,
      checkpoint,
    },
    signal: new AbortController().signal,
    saveCheckpoint: vi.fn(async (next: AgentCheckpoint) => {
      state.savedCheckpoints.push(next);
    }),
    appendEvent: vi.fn(async () => undefined),
  } as unknown as AgentExecutionHandlerContext;
}

beforeEach(() => {
  state.candidates = [];
  state.sources = [];
  state.snapshots = [];
  state.evidences = [];
  state.claims = [];
  state.relations = [];
  state.claimUpdates = [];
  state.report = null;
  state.savedCheckpoints = [];
  questionRow.evidence = [];
  runStatus = "researching";
  stageBehavior.claimExtractor = null;
  stageBehavior.synthesizer = null;
  stageBehavior.verifier = null;
  vi.clearAllMocks();
});

describe("durable research handler · researching stage", () => {
  it("ingests sciverse candidates with question-scoped context and marks candidate fetched", async () => {
    const provider: ResearchSourceProvider = {
      search: vi.fn(async () => [sciverseCandidate]),
      read: vi.fn(async () => sciverseRead),
    };
    const handler = createDurableResearchExecutionHandler({ provider });

    const result = await handler(createContext());

    expect(result.kind).toBe("rescheduled");
    expect(provider.search).toHaveBeenCalledWith(
      expect.objectContaining({ question: "Transformer 的自注意力机制如何工作？" }),
      "transformer self-attention",
    );
    expect(state.candidates).toHaveLength(1);
    expect(state.candidates[0].status).toBe("fetched");
    expect(state.candidates[0].researchSourceId).toBe(state.sources[0].id);
    expect(state.evidences).toHaveLength(1);
    expect(state.evidences[0].evidenceKey).toEqual(expect.any(String));
    expect(state.evidences[0].locator).toMatchObject({ kind: "sciverse", docId: "d".repeat(64), chunkId: "chunk-1" });
  });

  it("does not duplicate evidence when the same durable task reruns", async () => {
    const provider: ResearchSourceProvider = {
      search: vi.fn(async () => [sciverseCandidate]),
      read: vi.fn(async () => sciverseRead),
    };
    const handler = createDurableResearchExecutionHandler({ provider });

    await handler(createContext());
    const firstEvidenceIds = state.evidences.map((evidence) => evidence.id);
    // 模拟 lease 恢复后同一 task 重跑：candidate 已存在（findFirst 命中）
    await handler(createContext());

    expect(state.evidences).toHaveLength(1);
    expect(state.evidences.map((evidence) => evidence.id)).toEqual(firstEvidenceIds);
    expect(state.snapshots).toHaveLength(1);
  });

  it("marks candidate rejected when the source cannot be read", async () => {
    const provider: ResearchSourceProvider = {
      search: vi.fn(async () => [sciverseCandidate]),
      read: vi.fn(async () => null),
    };
    const handler = createDurableResearchExecutionHandler({ provider });

    const result = await handler(createContext());

    expect(result.kind).toBe("rescheduled");
    expect(state.candidates[0].status).toBe("rejected");
    expect(state.evidences).toHaveLength(0);
  });
});

function claimExtractionState(overrides: Record<string, unknown> = {}) {
  return {
    stage: "claim_extraction",
    modelCalls: 0,
    searchCalls: 0,
    fetchCalls: 0,
    sourceCount: 1,
    replanCount: 0,
    verificationRepairs: 0,
    ...overrides,
  };
}

describe("durable research handler · claim_extraction stage", () => {
  const extractorOutput = {
    claims: [{
      key: "self-attention-core",
      statement: "Transformer 以自注意力机制取代循环结构。",
      qualifiers: [],
      relations: [{ evidenceId: "ev-1", relation: "supports", confidence: 0.86, rationale: "原文直接陈述" }],
    }],
  };

  it("extracts atomic claims from persisted evidence with a deterministic claimKey", async () => {
    runStatus = "evaluating";
    questionRow.evidence = [evidenceRow()];
    stageBehavior.claimExtractor = extractorOutput;
    const handler = createDurableResearchExecutionHandler();

    const result = await handler(createContext({ researchState: claimExtractionState() }));

    expect(result.kind).toBe("rescheduled");
    expect(runResearchModelStage).toHaveBeenCalledWith(expect.objectContaining({ role: "research.claim_extractor" }));
    expect(state.claims).toHaveLength(1);
    expect(state.claims[0].claimKey).toBe("cex1:q1:self-attention-core");
    expect(state.claims[0].statement).toContain("自注意力");
    expect(state.relations).toHaveLength(1);
    expect(state.relations[0]).toMatchObject({ evidenceId: "ev-1", relation: "supports", confidence: 0.86 });
    const saved = state.savedCheckpoints.at(-1);
    expect(saved?.researchState?.stage).toBe("synthesizing");
    expect(saved?.researchState?.claimExtraction?.fingerprints["q-1"]).toEqual(expect.any(String));
    expect(saved?.researchState?.modelCalls).toBe(1);
  });

  it("skips the model call when the evidence fingerprint is unchanged", async () => {
    runStatus = "evaluating";
    questionRow.evidence = [evidenceRow()];
    const fingerprint = buildQuestionEvidenceFingerprint([{ id: "ev-1", status: "active" }]);
    const handler = createDurableResearchExecutionHandler();

    const result = await handler(createContext({
      researchState: claimExtractionState({ claimExtraction: { fingerprints: { "q-1": fingerprint } } }),
    }));

    expect(result.kind).toBe("rescheduled");
    expect(vi.mocked(runResearchModelStage).mock.calls.filter(([input]) => (input as { role: string }).role === "research.claim_extractor")).toHaveLength(0);
    expect(state.claims).toHaveLength(0);
    expect(state.savedCheckpoints.at(-1)?.researchState?.stage).toBe("synthesizing");
  });

  it("does not fall back to template claims when the extractor is unavailable", async () => {
    runStatus = "evaluating";
    questionRow.evidence = [evidenceRow()];
    stageBehavior.claimExtractor = null;
    const handler = createDurableResearchExecutionHandler();

    const result = await handler(createContext({ researchState: claimExtractionState() }));

    expect(result.kind).toBe("rescheduled");
    expect(state.claims).toHaveLength(0);
    expect(state.relations).toHaveLength(0);
    expect(state.savedCheckpoints.at(-1)?.researchState?.stage).toBe("synthesizing");
  });

  it("does not create duplicate claims when the stage reruns after lease recovery", async () => {
    runStatus = "evaluating";
    questionRow.evidence = [evidenceRow()];
    stageBehavior.claimExtractor = extractorOutput;
    const handler = createDurableResearchExecutionHandler();

    await handler(createContext({ researchState: claimExtractionState() }));
    // lease 恢复：stage 重新进入，但 fingerprint 已保存
    const saved = state.savedCheckpoints.at(-1)!;
    await handler(createContext({ researchState: { ...saved.researchState!, stage: "claim_extraction" } }));

    expect(state.claims).toHaveLength(1);
    expect(state.relations).toHaveLength(1);
  });
});

describe("durable research handler · synthesizing stage", () => {
  it("drives the fallback report from the claim graph instead of a raw evidence pile", async () => {
    runStatus = "synthesizing";
    questionRow.evidence = [evidenceRow()];
    state.claims.push({
      id: "claim-1",
      runId: "run-1",
      workspaceId: "ws-1",
      questionId: "q-1",
      claimKey: "cex1:q1:self-attention-core",
      statement: "Transformer 以自注意力机制取代循环结构。",
      status: "active",
      userEdited: false,
      quality: { qualifiers: [] },
    });
    state.relations.push({ claimId: "claim-1", evidenceId: "ev-1", relation: "supports", confidence: 0.9, rationale: "r" });
    const handler = createDurableResearchExecutionHandler();

    const result = await handler(createContext({ researchState: { ...claimExtractionState(), stage: "synthesizing", modelCalls: 12 } }));

    expect(result.kind).toBe("rescheduled");
    const saved = state.savedCheckpoints.at(-1);
    expect(saved?.researchState?.stage).toBe("verifying");
    expect(saved?.researchState?.draftReport).toContain("自注意力");
    expect(saved?.researchState?.draftReport).toContain("[E1]");
  });
});

describe("durable research handler · verifying stage", () => {
  function seedClaimWithEvidence(evidenceStatus: string) {
    questionRow.evidence = [evidenceRow({ status: evidenceStatus })];
    state.claims.push({
      id: "claim-1",
      runId: "run-1",
      workspaceId: "ws-1",
      questionId: "q-1",
      claimKey: "cex1:q1:self-attention-core",
      statement: "Transformer 以自注意力机制取代循环结构。",
      status: "active",
      userEdited: false,
      quality: null,
    });
    state.relations.push({
      claimId: "claim-1",
      evidenceId: "ev-1",
      relation: "supports",
      confidence: 0.9,
      rationale: "r",
      evidenceStatus,
    });
  }

  it("never lets the model verifier upgrade a claim with only invalid evidence", async () => {
    runStatus = "verifying";
    seedClaimWithEvidence("invalidated");
    stageBehavior.verifier = { claims: { "claim-1": { status: "verified", reasonCode: "sufficient_support" } } };
    const handler = createDurableResearchExecutionHandler();

    const result = await handler(createContext({ researchState: { ...claimExtractionState(), stage: "verifying", draftReport: "草稿", verificationRepairs: 1 } }));

    expect(result.kind).toBe("completed");
    const verificationUpdate = state.claimUpdates.find((update) => update.id === "claim-1" && "verificationStatus" in update.data);
    expect(verificationUpdate?.data.verificationStatus).toBe("unsupported");
    const report = state.report as { claimSnapshots: Array<{ verificationStatus: string }>; verificationSummary: { unsupportedClaims: number } };
    expect(report.claimSnapshots[0].verificationStatus).toBe("unsupported");
    expect(report.verificationSummary.unsupportedClaims).toBe(1);
  });

  it("verifies supported claims and persists structured quality", async () => {
    runStatus = "verifying";
    seedClaimWithEvidence("active");
    stageBehavior.verifier = { claims: { "claim-1": { status: "verified", reasonCode: "sufficient_support" } } };
    const handler = createDurableResearchExecutionHandler();

    const result = await handler(createContext({ researchState: { ...claimExtractionState(), stage: "verifying", draftReport: "草稿" } }));

    expect(result.kind).toBe("completed");
    const verificationUpdate = state.claimUpdates.find((update) => update.id === "claim-1" && "verificationStatus" in update.data);
    expect(verificationUpdate?.data.verificationStatus).toBe("verified");
    expect(verificationUpdate?.data.quality).toMatchObject({ directSupportCount: 1, uniqueSourceCount: 1 });
    const report = state.report as { claimSnapshots: Array<{ verificationStatus: string; reasonCode: string }>; citationMap: Record<string, Array<{ relation: string }>> };
    expect(report.claimSnapshots[0]).toMatchObject({ verificationStatus: "verified", reasonCode: "sufficient_support" });
    expect(report.citationMap["claim-1"][0].relation).toBe("supports");
  });
});
