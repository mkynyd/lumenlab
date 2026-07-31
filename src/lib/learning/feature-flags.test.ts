import { describe, expect, it } from "vitest";

import {
  LearningFeatureConfigurationError,
  buildLearningFeatureFlags,
} from "@/lib/learning/feature-flags";

describe("learning feature flags", () => {
  it("fails closed when no rollout is configured", () => {
    expect(buildLearningFeatureFlags({})).toEqual({
      rollout: "off",
      durableExecutionEnabled: false,
      apiEnabled: false,
      navigationVisible: false,
      todayIsDefault: false,
    });
  });

  it("enables the preview surface without changing the default landing page", () => {
    expect(
      buildLearningFeatureFlags({
        LEARNING_LOOP_ROLLOUT: "preview",
        AGENT_DURABLE_EXECUTION_ENABLED: "true",
      })
    ).toEqual({
      rollout: "preview",
      durableExecutionEnabled: true,
      apiEnabled: true,
      navigationVisible: true,
      todayIsDefault: false,
    });
  });

  it("rejects default rollout while durable execution is disabled", () => {
    expect(() =>
      buildLearningFeatureFlags({
        LEARNING_LOOP_ROLLOUT: "default",
        AGENT_DURABLE_EXECUTION_ENABLED: "false",
      })
    ).toThrow(LearningFeatureConfigurationError);
  });

  it("rejects unknown rollout values instead of silently enabling a feature", () => {
    expect(() =>
      buildLearningFeatureFlags({
        LEARNING_LOOP_ROLLOUT: "enabled",
      })
    ).toThrow(LearningFeatureConfigurationError);
  });
});
