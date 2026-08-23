import { describe, expect, it } from "vitest";
import { assertResearchRunTransition, canTransitionResearchRun, publicStageLabel } from "./state-machine";

describe("research run state machine", () => {
  it("allows confirmation and durable execution stages", () => {
    expect(canTransitionResearchRun("planning", "awaiting_confirmation")).toBe(true);
    expect(canTransitionResearchRun("researching", "evaluating")).toBe(true);
    expect(canTransitionResearchRun("verifying", "completed")).toBe(true);
  });

  it("rejects editing a completed run", () => {
    expect(() => assertResearchRunTransition("completed", "researching")).toThrow();
  });

  it("maps internal status to a public label", () => {
    expect(publicStageLabel("awaiting_scope_confirmation")).toBe("等待确认扩大范围");
  });
});
