import { describe, expect, it } from "vitest";
import { buildInitialAgentPlan, finalizeAgentPlan, parsePlanUpdate } from "./plan";

describe("buildInitialAgentPlan", () => {
  it("creates a visible, user-facing plan only for research and workflow profiles", () => {
    const plan = buildInitialAgentPlan({
      profile: "research",
      prompt: "比较两篇论文的方法和局限",
    });

    expect(plan).toMatchObject({
      status: "in_progress",
      currentStepId: "understand",
    });
    expect(plan?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "understand", status: "in_progress" }),
        expect.objectContaining({ id: "gather", status: "pending" }),
      ])
    );
    expect(buildInitialAgentPlan({ profile: "simple", prompt: "解释 TCP" })).toBeNull();
    expect(buildInitialAgentPlan({ profile: "rag", prompt: "总结课件" })).toBeNull();
  });
});

describe("parsePlanUpdate", () => {
  it("accepts a compact user-visible update and rejects malformed planning payloads", () => {
    expect(
      parsePlanUpdate({
        steps: [
          { id: "gather", title: "收集可核验的资料", status: "completed" },
          { id: "compare", title: "比较证据并形成结论", status: "in_progress" },
        ],
        currentStepId: "compare",
      })
    ).toEqual({
      steps: [
        { id: "gather", title: "收集可核验的资料", status: "completed" },
        { id: "compare", title: "比较证据并形成结论", status: "in_progress" },
      ],
      currentStepId: "compare",
    });

    expect(() =>
      parsePlanUpdate({
        steps: [{ id: "x", title: "x", status: "thinking" }],
        currentStepId: "x",
      })
    ).toThrow("计划更新格式无效");

    expect(() =>
      parsePlanUpdate({
        steps: [
          {
            id: "gather",
            title: "模型的隐藏推理过程",
            status: "in_progress",
            reason: "这段文字不应公开",
          },
        ],
        currentStepId: "gather",
      })
    ).toThrow("计划更新格式无效");
  });
});

describe("finalizeAgentPlan", () => {
  it("publishes a deterministic terminal state instead of leaving the current step in progress", () => {
    const initial = buildInitialAgentPlan({ profile: "workflow", prompt: "整理资料" })!;

    const awaitingApproval = finalizeAgentPlan(initial, "awaiting_approval");
    expect(awaitingApproval.status).toBe("blocked");
    expect(awaitingApproval.steps[0]).toMatchObject({
      status: "blocked",
      reason: "等待你的确认后继续。",
    });
    const completed = finalizeAgentPlan(initial, "completed");
    expect(completed.status).toBe("completed");
    expect(completed.steps[0]).toMatchObject({ status: "completed" });
    expect(completed.steps.slice(1)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "skipped" }),
      ])
    );
  });
});
