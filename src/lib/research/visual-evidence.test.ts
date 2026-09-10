// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const upsert = vi.fn();
const uploadObjectBuffer = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: { evidence: { upsert: (...args: unknown[]) => upsert(...args) } },
}));
vi.mock("@/lib/storage/object-storage", () => ({
  uploadObjectBuffer: (...args: unknown[]) => uploadObjectBuffer(...args),
}));

const {
  buildVisualEvidenceFingerprint,
  buildVisualEvidencePrompt,
  decideVisualEvidenceNeed,
  emptyVisualEvidenceMetrics,
  getResearchVisualPolicy,
  normalizeVisualObservationOutput,
  persistVisualObservations,
  RESEARCH_VISUAL_POLICIES,
  VISUAL_EVIDENCE_MAX_OBSERVATIONS,
} = await import("./visual-evidence");

beforeEach(() => {
  upsert.mockReset();
  uploadObjectBuffer.mockReset();
  upsert.mockImplementation(async (args: { create: { statement: string } }) => ({ id: `e-${args.create.statement.slice(0, 6)}` }));
  uploadObjectBuffer.mockResolvedValue({ provider: "local", key: "research/x/y/resources/abc.png" });
});

describe("research visual policy", () => {
  it("keeps quick at zero visual work and scales the other profiles", () => {
    expect(getResearchVisualPolicy("quick")).toMatchObject({ enabled: false, maxModelCalls: 0, maxResourceFetches: 0 });
    expect(getResearchVisualPolicy("deep").maxModelCalls).toBe(1);
    expect(getResearchVisualPolicy("comprehensive").maxModelCalls).toBe(2);
    expect(RESEARCH_VISUAL_POLICIES.comprehensive.maxQuestions).toBeGreaterThan(RESEARCH_VISUAL_POLICIES.deep.maxQuestions);
  });

  it("returns a copy so callers cannot mutate the shared policy", () => {
    const policy = getResearchVisualPolicy("deep");
    policy.maxModelCalls = 99;
    expect(getResearchVisualPolicy("deep").maxModelCalls).toBe(1);
  });

  it("starts every metric at zero", () => {
    expect(Object.values(emptyVisualEvidenceMetrics()).every((value) => value === 0)).toBe(true);
  });
});

describe("visual need decision", () => {
  it("triggers for an unresolved question that asks about a measured figure", () => {
    expect(decideVisualEvidenceNeed({
      questionText: "Compare the measured throughput reported in Figure 3",
      status: "partially_resolved",
      fullTextEvidenceCount: 2,
    })).toMatchObject({ needed: true, reason: "question_requests_figure_measurement" });
  });

  it("still triggers when the user explicitly names a figure even if the question was resolved", () => {
    // 「有证据」不等于「已经拿到了图表里的数值」：用户点名图表时应按需读数。
    expect(decideVisualEvidenceNeed({
      questionText: "各方法在原始论文图表中报告的实测吞吐量是多少？",
      status: "resolved",
      fullTextEvidenceCount: 3,
    })).toMatchObject({ needed: true, reason: "question_requests_figure_measurement" });
  });

  it("does not fire for a resolved question that only asks a quantitative question", () => {
    expect(decideVisualEvidenceNeed({
      questionText: "Compare the measured throughput reported by each method",
      status: "resolved",
      fullTextEvidenceCount: 2,
    })).toMatchObject({ needed: false, reason: "no_unresolved_gap" });
  });

  it("fires for an unresolved quantitative gap without a figure noun", () => {
    expect(decideVisualEvidenceNeed({
      questionText: "Which method reports the highest measured throughput?",
      status: "unresolved",
      fullTextEvidenceCount: 2,
    })).toMatchObject({ needed: true, reason: "unresolved_quantitative_gap" });
  });

  it("does not fire without full-text evidence", () => {
    expect(decideVisualEvidenceNeed({
      questionText: "表格中的定量结果是什么",
      status: "unresolved",
      fullTextEvidenceCount: 0,
    })).toMatchObject({ needed: false, reason: "no_full_text_evidence" });
  });

  it("does not fire for a question with no measurement wording", () => {
    expect(decideVisualEvidenceNeed({
      questionText: "What is the history of mixture-of-experts routing?",
      status: "unresolved",
      fullTextEvidenceCount: 3,
    })).toMatchObject({ needed: false, reason: "no_visual_signal", signals: [] });
  });

  it("recognises completion criteria signals as well as the question text", () => {
    expect(decideVisualEvidenceNeed({
      questionText: "How much faster is the sparse router?",
      completionCriteria: ["给出图表中的实测加速比"],
      status: "controversial",
      fullTextEvidenceCount: 1,
    })).toMatchObject({ needed: true, reason: "question_requests_figure_measurement" });
  });
});

describe("structured visual output normalization", () => {
  const allowed = new Set(["r1", "r2"]);

  it("keeps well-formed observations and clamps confidence", () => {
    const result = normalizeVisualObservationOutput({
      observations: [
        { statement: "Top-1 accuracy is 87.3%", resourceId: "r1", figureNo: 2, metric: "accuracy", value: "87.3", unit: "%", confidence: 1.7, limitations: "axis unlabeled" },
        { statement: "Latency drops", resourceId: "r2", confidence: -0.5 },
      ],
    }, allowed);
    expect(result.rejected).toBe(0);
    expect(result.observations[0]).toMatchObject({ confidence: 1, figureNo: 2, metric: "accuracy", unit: "%" });
    expect(result.observations[1]).toMatchObject({ confidence: 0 });
  });

  it("rejects unknown resource ids, missing statements and non-finite confidence", () => {
    const result = normalizeVisualObservationOutput({
      observations: [
        { statement: "x", resourceId: "r9", confidence: 0.5 },
        { resourceId: "r1", confidence: 0.5 },
        { statement: "y", resourceId: "r1", confidence: Number.NaN },
        { statement: "z", resourceId: "r1", confidence: 0.4 },
      ],
    }, allowed);
    expect(result.rejected).toBe(3);
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0].statement).toBe("z");
  });

  it("accepts a bare observations array only, never free-form markdown", () => {
    expect(normalizeVisualObservationOutput("# Figure 3 shows 87%", allowed)).toEqual({ observations: [], rejected: 0 });
    expect(normalizeVisualObservationOutput({ observations: "87%" }, allowed)).toEqual({ observations: [], rejected: 0 });
    expect(normalizeVisualObservationOutput(null, allowed)).toEqual({ observations: [], rejected: 0 });
  });

  it("bounds the number of persisted observations and truncates fields", () => {
    const result = normalizeVisualObservationOutput({
      observations: Array.from({ length: VISUAL_EVIDENCE_MAX_OBSERVATIONS + 4 }, () => ({
        statement: "s".repeat(2_000),
        resourceId: "r1",
        confidence: 0.5,
        limitations: "l".repeat(500),
      })),
    }, allowed);
    expect(result.observations).toHaveLength(VISUAL_EVIDENCE_MAX_OBSERVATIONS);
    expect(result.observations[0].statement.length).toBe(600);
    expect(result.observations[0].limitations!.length).toBe(120);
  });
});

describe("visual prompt", () => {
  it("only exposes explicitly selected resources and bounded context", () => {
    const prompt = buildVisualEvidencePrompt({
      question: "compare throughput",
      resources: [
        { resourceId: "r1", kind: "figure", alt: "Figure 3", caption: "throughput by batch size", pageNo: 5 },
      ],
      bodyContext: "x".repeat(10_000),
    });
    expect(prompt).toContain("\"resourceId\":\"r1\"");
    expect(prompt).toContain("compare throughput");
    expect(prompt.length).toBeLessThan(4_000);
  });
});

describe("visual observation persistence", () => {
  const resources = [
    {
      resourceId: "r1",
      fileName: "dt=2025-08-07/ht=09/fig3.png",
      kind: "figure" as const,
      mimeType: "image/png",
      bytes: Buffer.from([1, 2, 3]),
      alt: "Figure 3",
      caption: "Figure 3: throughput",
      pageNo: 5,
    },
  ];
  const base = {
    userId: "u1",
    workspaceId: "w1",
    runId: "r1",
    questionId: "q1",
    sourceSnapshotId: "s1",
    canonicalKey: "doi:10.1/x",
    snapshotContentHash: "hash-1",
    analysisModel: "deepseek-flash",
  };

  it("persists visual_observation evidence with full resource provenance", async () => {
    const persisted = await persistVisualObservations({
      ...base,
      resources,
      observations: [{ statement: "throughput is 1.8x", resourceId: "r1", confidence: 0.7, metric: "speedup", value: "1.8", unit: "x" }],
    });
    expect(persisted).toHaveLength(1);
    const args = upsert.mock.calls[0][0] as { create: Record<string, unknown> };
    expect(args.create.evidenceType).toBe("visual_observation");
    expect(args.create.statement).toBe("throughput is 1.8x");
    expect(args.create.locator).toMatchObject({
      kind: "sciverse_resource",
      resourceId: "r1",
      resourceKind: "figure",
      pageNo: 5,
    });
    expect(args.create.provenance).toMatchObject({
      modality: "visual",
      provider: "sciverse",
      resourceId: "r1",
      analysisModel: "deepseek-flash",
      confidence: 0.7,
      sourceSnapshotId: "s1",
      rawContentPersisted: true,
    });
    expect(args.create.evidenceKey).toEqual(expect.any(String));
  });

  it("never marks a visual observation as a direct quote", async () => {
    await persistVisualObservations({ ...base, resources, observations: [{ statement: "s", resourceId: "r1", confidence: 0.5 }] });
    const args = upsert.mock.calls[0][0] as { create: Record<string, unknown> };
    expect(args.create.evidenceType).not.toBe("direct_quote");
  });

  it("degrades to bounded provenance when the resource upload fails", async () => {
    uploadObjectBuffer.mockRejectedValue(new Error("storage down"));
    await persistVisualObservations({ ...base, resources, observations: [{ statement: "s", resourceId: "r1", confidence: 0.5 }] });
    const args = upsert.mock.calls[0][0] as { create: { provenance: Record<string, unknown> } };
    expect(args.create.provenance.rawContentPersisted).toBe(false);
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it("drops observations whose resource disappeared", async () => {
    const persisted = await persistVisualObservations({
      ...base,
      resources,
      observations: [{ statement: "s", resourceId: "r2", confidence: 0.5 }],
    });
    expect(persisted).toEqual([]);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("produces a stable evidence key for the same snapshot, locator and statement", async () => {
    const observation = { statement: "s", resourceId: "r1", confidence: 0.5 } as const;
    await persistVisualObservations({ ...base, resources, observations: [observation] });
    await persistVisualObservations({ ...base, resources, observations: [observation] });
    const first = (upsert.mock.calls[0][0] as { create: { evidenceKey: string } }).create.evidenceKey;
    const second = (upsert.mock.calls[1][0] as { create: { evidenceKey: string } }).create.evidenceKey;
    expect(first).toBe(second);
  });
});

describe("visual fingerprint", () => {
  it("is order independent and changes when the evidence set changes", () => {
    const a = buildVisualEvidenceFingerprint({ evidenceIds: ["a", "b"], status: "unresolved" });
    const b = buildVisualEvidenceFingerprint({ evidenceIds: ["b", "a"], status: "unresolved" });
    const c = buildVisualEvidenceFingerprint({ evidenceIds: ["a", "b", "c"], status: "unresolved" });
    const d = buildVisualEvidenceFingerprint({ evidenceIds: ["a", "b"], status: "resolved" });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
  });
});
