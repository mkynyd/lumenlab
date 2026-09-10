import { beforeEach, describe, expect, it, vi } from "vitest";
import { runAgentRuntime } from "@/lib/agent/runtime";
import { prisma } from "@/lib/db";
import { normalizeResearchEvaluatorDecision, normalizeResearchPlannerDecision, normalizeResearchVerifierDecision, normalizeResearchWorkerDecision, parseStructuredJson, runResearchModelStage } from "./model-stage";
import { applyResearchPlannerDecision, buildResearchPlan } from "./plan";

vi.mock("@/lib/agent/runtime", () => ({ runAgentRuntime: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: { message: { findUnique: vi.fn() } },
}));

const stageInput = {
  role: "research.evaluator" as const,
  userId: "user-1",
  conversationId: "conversation-1",
  projectId: "project-1",
  signal: new AbortController().signal,
  prompt: "Return structured JSON",
};

function events(values: unknown[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const value of values) yield value;
    },
  };
}

describe("research model stage contracts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("parses only the persisted final message and excludes generic project media", async () => {
    vi.mocked(runAgentRuntime).mockResolvedValue({
      metadata: {},
      events: events([
        { type: "reasoning_delta", text: '{"status":"wrong"}' },
        { type: "completed" },
      ]),
      completion: Promise.resolve({
        status: "completed",
        conversationId: "conversation-1",
        messageId: "message-1",
        provider: "deepseek",
        model: "deepseek-flash",
        usage: { promptTokens: 3, completionTokens: 2, totalTokens: 5 },
        sources: [],
      }),
    } as never);
    vi.mocked(prisma.message.findUnique).mockResolvedValue({
      content: '{"status":"resolved"}',
    } as never);

    const result = await runResearchModelStage<{ status: string }>(stageInput);

    expect(result.value).toEqual({ status: "resolved" });
    expect(runAgentRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation: { id: "conversation-1" },
        capabilities: expect.objectContaining({ selectedFileIds: [] }),
      })
    );
  });

  it("fails closed when the Responses run does not complete", async () => {
    vi.mocked(runAgentRuntime).mockResolvedValue({
      metadata: {},
      events: events([]),
      completion: Promise.reject(new Error("Responses ended incomplete")),
    } as never);

    const result = await runResearchModelStage(stageInput);

    expect(result).toMatchObject({
      value: null,
      attempted: true,
      model: "deepseek-flash",
    });
    expect(prisma.message.findUnique).not.toHaveBeenCalled();
  });

  it("extracts bounded JSON from a fenced model response", () => {
    expect(parseStructuredJson<{ queries: string[] }>("说明\n```json\n{\"queries\":[\"a\"]}\n```"))
      .toEqual({ queries: ["a"] });
  });

  it("falls back to the question when a worker response is unusable", () => {
    expect(normalizeResearchWorkerDecision({ queries: ["  query  ", "", 1], rationale: "x" }, "fallback"))
      .toEqual({ queries: ["query"], rationale: "x" });
    expect(normalizeResearchWorkerDecision(null, "fallback").queries).toEqual(["fallback"]);
  });

  it("keeps evaluator values inside the public quality contract", () => {
    expect(normalizeResearchEvaluatorDecision({ status: "controversial", coverage: 4, directness: -1, followUpQueries: ["补充"] }, {
      status: "unresolved", coverage: 0, directness: 0,
    })).toEqual({ status: "controversial", coverage: 1, directness: 0, gap: undefined, followUpQueries: ["补充"] });
  });

  it("drops verifier claims with unknown statuses", () => {
    expect(normalizeResearchVerifierDecision({ claims: { a: { status: "verified", reasonCode: "sufficient_support" }, b: { status: "unknown" } } }))
      .toEqual({ claims: { a: { status: "verified", reasonCode: "sufficient_support" } } });
  });

  it("normalizes unknown verifier reason codes to model_review", () => {
    expect(normalizeResearchVerifierDecision({ claims: { a: { status: "verified", reasonCode: "direct" }, b: { status: "conflicted" } } }))
      .toEqual({ claims: { a: { status: "verified", reasonCode: "model_review" }, b: { status: "conflicted", reasonCode: "model_review" } } });
  });

  it("bounds planner output and applies only known question keys", () => {
    const decision = normalizeResearchPlannerDecision({
      scope: "  更具体的范围 ",
      timeRange: null,
      sourceStrategy: ["官方资料", "原始研究"],
      questions: [{ key: "q1", priority: "critical", question: "修订后的问题" }, { key: "q99", question: "不得写入" }],
    });
    const plan = applyResearchPlannerDecision(buildResearchPlan({ question: "原问题", profile: "deep" }), decision);
    expect(plan.scope).toBe("更具体的范围");
    expect(plan.researchQuestions[0].question).toBe("修订后的问题");
    expect(plan.researchQuestions.some((item) => item.question === "不得写入")).toBe(false);
  });
});
