import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReadResearchSource } from "./source-provider";

interface SourceRow {
  id: string;
  workspaceId: string;
  canonicalKey: string;
  title: string | null;
  aliases: unknown;
  metadata: unknown;
  doi: string | null;
}

interface SnapshotRow {
  id: string;
  runId: string;
  sourceId: string;
  contentHash: string;
  rawContentLocation: unknown;
  excerpt: string | null;
  metadata: Record<string, unknown>;
}

interface EvidenceRow {
  id: string;
  runId: string;
  evidenceKey: string | null;
  sourceSnapshotId: string;
  statement: string;
  excerpt: string;
  evidenceType: string;
  locator: unknown;
  provenance: unknown;
}

const state = {
  sources: [] as SourceRow[],
  snapshots: [] as SnapshotRow[],
  evidences: [] as EvidenceRow[],
  candidates: [] as Array<{ id: string; status: string; researchSourceId: string | null }>,
};

let idCounter = 0;
function nextId(prefix: string) {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

vi.mock("@/lib/db", () => ({
  prisma: {
    researchSource: {
      findUnique: vi.fn(async ({ where }: { where: { workspaceId_canonicalKey: { workspaceId: string; canonicalKey: string } } }) =>
        state.sources.find((row) => row.workspaceId === where.workspaceId_canonicalKey.workspaceId && row.canonicalKey === where.workspaceId_canonicalKey.canonicalKey) ?? null),
      create: vi.fn(async ({ data }: { data: Omit<SourceRow, "id"> }) => {
        const row = { ...data, id: nextId("source") };
        state.sources.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<SourceRow> }) => {
        const row = state.sources.find((item) => item.id === where.id);
        if (!row) throw new Error("source not found");
        Object.assign(row, data);
        return row;
      }),
    },
    researchSourceSnapshot: {
      findFirst: vi.fn(async ({ where }: { where: { runId: string; sourceId: string; contentHash: string } }) =>
        state.snapshots.find((row) => row.runId === where.runId && row.sourceId === where.sourceId && row.contentHash === where.contentHash) ?? null),
      create: vi.fn(async ({ data }: { data: Omit<SnapshotRow, "id"> }) => {
        const row = { ...data, id: nextId("snapshot"), rawContentLocation: data.rawContentLocation ?? null };
        state.snapshots.push(row);
        return row;
      }),
    },
    evidence: {
      upsert: vi.fn(async ({ where, create }: { where: { runId_evidenceKey: { runId: string; evidenceKey: string } }; create: Omit<EvidenceRow, "id"> }) => {
        const existing = state.evidences.find((row) => row.runId === where.runId_evidenceKey.runId && row.evidenceKey === where.runId_evidenceKey.evidenceKey);
        if (existing) return existing;
        const row = { ...create, id: nextId("evidence") };
        state.evidences.push(row);
        return row;
      }),
    },
    researchSourceCandidate: {
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
  },
}));

const uploadObjectBuffer = vi.fn();
vi.mock("@/lib/storage/object-storage", () => ({
  uploadObjectBuffer: (...args: unknown[]) => uploadObjectBuffer(...args),
}));

import { buildResearchEvidenceKey, ingestResearchReadSource, markCandidateFetched, markCandidateRejected } from "./evidence-ingestion";

function sciverseRead(overrides: Partial<ReadResearchSource> = {}): ReadResearchSource {
  return {
    candidate: {
      provider: "sciverse",
      kind: "academic_paper",
      externalId: "10.48550/arxiv.1706.03762",
      title: "Attention Is All You Need",
      url: "https://arxiv.org/abs/1706.03762",
      metadata: { doi: "10.48550/arxiv.1706.03762", docId: "d".repeat(64), uniqueId: "paper:1", citationCount: 100000 },
    },
    title: "Attention Is All You Need",
    content: "slice one\n\nslice two",
    excerpt: "slice one",
    locator: { kind: "sciverse", docId: "d".repeat(64), chunkId: "chunk-1", offset: 1200, pageNo: 3 },
    sourceVersion: "2017",
    metadata: { provider: "sciverse", citationCount: 100000 },
    evidenceType: "direct_quote",
    slices: [
      {
        excerpt: "The Transformer uses self-attention.",
        locator: { kind: "sciverse", docId: "d".repeat(64), chunkId: "chunk-1", offset: 1200, pageNo: 3, doi: "10.48550/arxiv.1706.03762" },
        provenance: { provider: "sciverse", retrievalMethod: "sciverse.read", semanticScore: 0.83, queryHash: "abc123" },
      },
      {
        excerpt: "Multi-head attention allows the model to jointly attend.",
        locator: { kind: "sciverse", docId: "d".repeat(64), chunkId: "chunk-2", offset: 5400, doi: "10.48550/arxiv.1706.03762" },
        provenance: { provider: "sciverse", retrievalMethod: "sciverse.semantic_search", semanticScore: 0.71, queryHash: "abc123" },
      },
    ],
    snapshotScope: { type: "bounded_evidence_slices", provider: "sciverse", docId: "d".repeat(64), sliceCount: 2 },
    ...overrides,
  };
}

const ingestInput = { userId: "user-1", workspaceId: "ws-1", runId: "run-1", questionId: "q-1" };

beforeEach(() => {
  state.sources = [];
  state.snapshots = [];
  state.evidences = [];
  state.candidates = [];
  uploadObjectBuffer.mockReset();
  uploadObjectBuffer.mockResolvedValue({ provider: "qiniu", key: "research/user-1/run-1/hash.md" });
});

describe("research evidence ingestion", () => {
  it("creates chunk-level evidence with sciverse locator and provenance", async () => {
    const result = await ingestResearchReadSource({ ...ingestInput, read: sciverseRead() });

    expect(result).not.toBeNull();
    expect(result?.evidences).toHaveLength(2);
    expect(state.evidences[0]).toMatchObject({
      evidenceType: "direct_quote",
      excerpt: "The Transformer uses self-attention.",
    });
    expect(state.evidences[0].locator).toMatchObject({ kind: "sciverse", docId: "d".repeat(64), chunkId: "chunk-1", offset: 1200, pageNo: 3 });
    expect(state.evidences[0].provenance).toMatchObject({ provider: "sciverse", retrievalMethod: "sciverse.read", semanticScore: 0.83 });
    expect(state.evidences[0].statement).toBe("The Transformer uses self-attention.");
    expect(typeof state.evidences[0].evidenceKey).toBe("string");
    expect(state.evidences[0].evidenceKey).not.toBe(state.evidences[1].evidenceKey);
    expect(state.snapshots[0].metadata).toMatchObject({ provider: "sciverse", rawContentPersisted: true });
    expect((state.snapshots[0].metadata.scope as Record<string, unknown>).type).toBe("bounded_evidence_slices");
  });

  it("merges providers into one canonical source by normalized DOI", async () => {
    await ingestResearchReadSource({ ...ingestInput, read: sciverseRead() });
    const crossrefRead: ReadResearchSource = {
      candidate: { provider: "crossref", kind: "academic_paper", externalId: "10.48550/arXiv.1706.03762", title: "Attention Is All You Need", url: "https://doi.org/10.48550/arXiv.1706.03762", metadata: { doi: "10.48550/arXiv.1706.03762" } },
      title: "Attention Is All You Need",
      content: "{\"DOI\":\"10.48550/arXiv.1706.03762\"}",
      excerpt: "Crossref record excerpt",
      locator: { kind: "crossref", doi: "10.48550/arxiv.1706.03762" },
      sourceVersion: null,
      metadata: { publisher: "arXiv" },
    };
    await ingestResearchReadSource({ ...ingestInput, read: crossrefRead });

    expect(state.sources).toHaveLength(1);
    expect(state.sources[0].canonicalKey).toBe("doi:10.48550/arxiv.1706.03762");
    expect(state.sources[0].aliases).toEqual({ urls: ["https://arxiv.org/abs/1706.03762", "https://doi.org/10.48550/arXiv.1706.03762"] });
    expect(state.sources[0].metadata).toMatchObject({ provider: "sciverse", publisher: "arXiv" });
  });

  it("uses provider-scoped identity when no DOI or URL exists", async () => {
    const read = sciverseRead();
    read.candidate = { ...read.candidate, url: null, metadata: { docId: "d".repeat(64), uniqueId: "paper:1" } };
    await ingestResearchReadSource({ ...ingestInput, read });

    expect(state.sources[0].canonicalKey).toBe(`academic_paper:sciverse:${"d".repeat(64)}`);
  });

  it("is idempotent across durable task retries", async () => {
    const first = await ingestResearchReadSource({ ...ingestInput, read: sciverseRead() });
    const second = await ingestResearchReadSource({ ...ingestInput, read: sciverseRead() });

    expect(state.sources).toHaveLength(1);
    expect(state.snapshots).toHaveLength(1);
    expect(state.evidences).toHaveLength(2);
    expect(second?.evidences.map((evidence) => evidence.id)).toEqual(first?.evidences.map((evidence) => evidence.id));
  });

  it("persists bounded evidence when object storage fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    uploadObjectBuffer.mockRejectedValue(new Error("qiniu 503"));

    const result = await ingestResearchReadSource({ ...ingestInput, read: sciverseRead() });

    expect(result).not.toBeNull();
    expect(result?.rawContentPersisted).toBe(false);
    expect(state.snapshots).toHaveLength(1);
    expect(state.snapshots[0].rawContentLocation).toBeNull();
    expect(state.snapshots[0].metadata.rawContentPersisted).toBe(false);
    expect(state.snapshots[0].excerpt).toBe("slice one");
    expect(state.evidences).toHaveLength(2);
    expect(consoleError).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });

  it("marks candidates fetched with the canonical source link", async () => {
    state.candidates.push({ id: "cand-1", status: "selected", researchSourceId: null });
    await markCandidateFetched("cand-1", "source-9");
    expect(state.candidates[0]).toMatchObject({ status: "fetched", researchSourceId: "source-9" });
  });

  it("marks candidates rejected but never downgrades a fetched candidate", async () => {
    state.candidates.push({ id: "cand-1", status: "selected", researchSourceId: null }, { id: "cand-2", status: "fetched", researchSourceId: "source-1" });
    await markCandidateRejected("cand-1");
    await markCandidateRejected("cand-2");
    expect(state.candidates[0].status).toBe("rejected");
    expect(state.candidates[1].status).toBe("fetched");
  });

  it("produces stable evidence keys independent of statement formatting", () => {
    const input = {
      canonicalKey: "doi:10.48550/arxiv.1706.03762",
      contentHash: "hash",
      locator: { kind: "sciverse", docId: "d", chunkId: "c", offset: 10, pageNo: 2, extra: "ignored" },
      excerpt: "some excerpt",
      evidenceType: "direct_quote",
    };
    expect(buildResearchEvidenceKey(input)).toBe(buildResearchEvidenceKey(input));
    expect(buildResearchEvidenceKey(input)).not.toBe(buildResearchEvidenceKey({ ...input, locator: { ...input.locator, offset: 11 } }));
  });
});
