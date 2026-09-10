import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentCheckpoint } from "@/lib/agent/executions/agent-execution-store";
import type { AgentExecutionHandlerContext } from "@/lib/agent/executions/agent-execution-runner";
import type { ReadResearchSource, ResearchCandidate, ResearchSourceProvider } from "./source-provider";

const state = {
  candidates: [] as Array<{ id: string; runId: string; provider: string; externalId: string; status: string; researchSourceId: string | null }>,
  sources: [] as Array<{ id: string; workspaceId: string; canonicalKey: string }>,
  snapshots: [] as Array<{ id: string; runId: string; sourceId: string; contentHash: string }>,
  evidences: [] as Array<{ id: string; runId: string; evidenceKey: string | null; locator: unknown }>,
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

vi.mock("@/lib/db", () => ({
  prisma: {
    researchRun: {
      findFirst: vi.fn(async () => ({ ...researchRunRow })),
      findUnique: vi.fn(async () => ({ status: "researching" })),
      update: vi.fn(async () => ({})),
    },
    researchTask: {
      updateMany: vi.fn(async () => ({ count: 0 })),
      findMany: vi.fn(async () => [{ ...taskRow, question: { ...taskRow.question } }]),
      update: vi.fn(async () => ({})),
      count: vi.fn(async () => 0),
    },
    researchQuestion: {
      update: vi.fn(async () => ({})),
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
    runResearchModelStage: vi.fn(async () => ({
      value: { queries: ["transformer self-attention"], rationale: "test" },
      usage: null,
      model: "deepseek-v4-flash-vision-exp",
      attempted: false,
    })),
  };
});

import { createDurableResearchExecutionHandler } from "./durable-handler";

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

function createContext(): AgentExecutionHandlerContext {
  const checkpoint = { request: { executionKind: "research", researchRunId: "run-1" } } as unknown as AgentCheckpoint;
  return {
    execution: {
      id: "exec-1",
      userId: "user-1",
      conversationId: "conv-1",
      attempt: 1,
      checkpoint,
    },
    signal: new AbortController().signal,
    saveCheckpoint: vi.fn(async () => undefined),
    appendEvent: vi.fn(async () => undefined),
  } as unknown as AgentExecutionHandlerContext;
}

beforeEach(() => {
  state.candidates = [];
  state.sources = [];
  state.snapshots = [];
  state.evidences = [];
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
