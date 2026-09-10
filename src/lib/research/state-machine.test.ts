import { describe, expect, it } from "vitest";
import {
  assertResearchRunTransition,
  canTransitionResearchRun,
  describeResearchDegradation,
  publicStageLabel,
  resolveResearchPublicStage,
} from "./state-machine";
import { RESEARCH_RUN_STATUSES } from "./contracts";

describe("research run state machine", () => {
  it("allows confirmation and durable execution stages", () => {
    expect(canTransitionResearchRun("planning", "awaiting_confirmation")).toBe(true);
    expect(canTransitionResearchRun("researching", "evaluating")).toBe(true);
    expect(canTransitionResearchRun("verifying", "researching")).toBe(true);
    expect(canTransitionResearchRun("verifying", "completed")).toBe(true);
  });

  it("rejects editing a completed run", () => {
    expect(() => assertResearchRunTransition("completed", "researching")).toThrow();
  });

  it("maps internal status to a public label", () => {
    expect(publicStageLabel("awaiting_scope_confirmation")).toBe("等待确认扩大范围");
  });
});

describe("public research stage resolution", () => {
  it("prefers run status for terminal and user-blocking states", () => {
    expect(resolveResearchPublicStage("completed", "verifying")).toMatchObject({ key: "completed" });
    expect(resolveResearchPublicStage("failed", "researching")).toMatchObject({ key: "failed", label: "执行失败" });
    expect(resolveResearchPublicStage("cancelled", null)).toMatchObject({ key: "cancelled" });
    expect(resolveResearchPublicStage("awaiting_confirmation", "researching")).toMatchObject({ key: "awaiting_confirmation" });
    expect(resolveResearchPublicStage("awaiting_scope_confirmation", null)).toMatchObject({ key: "awaiting_scope_confirmation" });
    expect(resolveResearchPublicStage("queued", null)).toMatchObject({ key: "queued" });
  });

  it("uses the durable checkpoint stage to split phases that share a run status", () => {
    // citation expansion, visual evidence and claim extraction all run under
    // run.status === "evaluating"; a single vague label would be wrong.
    for (const [stage, label] of [
      ["citation_expansion", "沿引用关系扩展来源"],
      ["visual_evidence", "分析论文图表"],
      ["claim_extraction", "提炼并核验命题"],
    ] as const) {
      expect(resolveResearchPublicStage("evaluating", stage)).toEqual({ key: stage, label });
    }
    expect(resolveResearchPublicStage("researching", "researching")).toMatchObject({ key: "researching" });
  });

  it("falls back to the run status when the checkpoint stage is missing or unknown", () => {
    expect(resolveResearchPublicStage("researching", null)).toMatchObject({ key: "researching" });
    expect(resolveResearchPublicStage("researching", "not_a_stage")).toMatchObject({ key: "researching" });
    expect(resolveResearchPublicStage("evaluating", "planning")).toMatchObject({ key: "evaluating" });
  });

  it("maps every public status to a non-empty label", () => {
    for (const status of RESEARCH_RUN_STATUSES) {
      expect(resolveResearchPublicStage(status, null).label.length).toBeGreaterThan(0);
    }
  });
});

describe("provider degradation messages", () => {
  it("explains supported degradations in user language without stack traces", () => {
    for (const code of ["sciverse_error", "arxiv_error", "web_error", "visual_resources_unavailable"]) {
      const message = describeResearchDegradation(code);
      expect(message).toBeTruthy();
      expect(message).not.toMatch(/Error|AbortError|stack/i);
    }
  });

  it("does not invent a message for unknown codes", () => {
    expect(describeResearchDegradation("something_new")).toBeNull();
  });
});
