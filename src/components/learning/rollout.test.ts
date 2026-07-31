import { describe, expect, it } from "vitest";

import { resolveLearningPageFlags } from "@/components/learning/rollout";

describe("resolveLearningPageFlags", () => {
  it("is unavailable when rollout is unset (off)", () => {
    expect(resolveLearningPageFlags({})).toEqual({
      available: false,
      rollout: "off",
    });
  });

  it("is unavailable when rollout is explicitly off", () => {
    expect(
      resolveLearningPageFlags({ LEARNING_LOOP_ROLLOUT: "off" })
    ).toEqual({ available: false, rollout: "off" });
  });

  it("is available in preview without durable execution", () => {
    expect(
      resolveLearningPageFlags({ LEARNING_LOOP_ROLLOUT: "preview" })
    ).toEqual({ available: true, rollout: "preview" });
  });

  it("is available in default when durable execution is enabled", () => {
    expect(
      resolveLearningPageFlags({
        LEARNING_LOOP_ROLLOUT: "default",
        AGENT_DURABLE_EXECUTION_ENABLED: "true",
      })
    ).toEqual({ available: true, rollout: "default" });
  });

  it("fails closed when default lacks durable execution", () => {
    expect(
      resolveLearningPageFlags({ LEARNING_LOOP_ROLLOUT: "default" })
    ).toEqual({ available: false, rollout: "off" });
  });

  it("fails closed on invalid rollout values", () => {
    expect(
      resolveLearningPageFlags({ LEARNING_LOOP_ROLLOUT: "bogus" })
    ).toEqual({ available: false, rollout: "off" });
  });
});
