import { afterEach, describe, expect, it, vi } from "vitest";
import { researchModelConfiguration, selectResearchModel } from "./model-routing";

describe("research model routing", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("routes all default roles through the active DeepSeek Responses model", () => {
    expect(selectResearchModel("research.worker")).toMatchObject({ provider: "deepseek", model: "deepseek-flash", source: "default" });
    expect(selectResearchModel("research.synthesizer")).toMatchObject({ provider: "deepseek", model: "deepseek-flash", reasoningEffort: "max" });
  });

  it("exposes all role assignments as structured configuration", () => {
    const configuration = researchModelConfiguration();
    expect(Object.keys(configuration)).toHaveLength(5);
    expect(configuration["research.verifier"].role).toBe("research.verifier");
  });

  it("allows active overrides, upgrades legacy IDs, and rejects unknown models", () => {
    vi.stubEnv("RESEARCH_MODEL_RESEARCH_WORKER", "minimax-m3");
    expect(selectResearchModel("research.worker")).toMatchObject({ provider: "minimax", model: "minimax-m3", source: "environment" });
    vi.stubEnv("RESEARCH_MODEL_RESEARCH_VERIFIER", "deepseek-v4-pro");
    expect(selectResearchModel("research.verifier")).toMatchObject({ provider: "deepseek", model: "deepseek-flash", source: "environment" });
    vi.stubEnv("RESEARCH_MODEL_RESEARCH_PLANNER", "unknown-model");
    expect(() => selectResearchModel("research.planner")).toThrow(
      "RESEARCH_MODEL_RESEARCH_PLANNER"
    );
  });
});
