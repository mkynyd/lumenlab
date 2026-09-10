import { afterEach, describe, expect, it, vi } from "vitest";
import { researchModelConfiguration, selectResearchModel } from "./model-routing";

describe("research model routing", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("routes all default roles through the active DeepSeek Responses model", () => {
    expect(selectResearchModel("research.worker")).toMatchObject({ provider: "deepseek", model: "deepseek-flash", source: "default" });
    expect(selectResearchModel("research.synthesizer")).toMatchObject({ provider: "deepseek", model: "deepseek-flash", reasoningEffort: "max" });
    expect(selectResearchModel("research.claim_extractor")).toMatchObject({ provider: "deepseek", model: "deepseek-flash", reasoningEffort: "high" });
  });

  it("exposes all role assignments as structured configuration", () => {
    const configuration = researchModelConfiguration();
    expect(Object.keys(configuration)).toHaveLength(6);
    expect(configuration["research.verifier"].role).toBe("research.verifier");
    expect(configuration["research.claim_extractor"].role).toBe("research.claim_extractor");
  });

  it("allows active overrides, upgrades legacy IDs, and rejects unknown models", () => {
    vi.stubEnv("RESEARCH_MODEL_RESEARCH_WORKER", "minimax-m3");
    expect(selectResearchModel("research.worker")).toMatchObject({ provider: "minimax", model: "minimax-m3", source: "environment" });
    vi.stubEnv("RESEARCH_MODEL_RESEARCH_VERIFIER", "deepseek-v4-pro");
    expect(selectResearchModel("research.verifier")).toMatchObject({ provider: "deepseek", model: "deepseek-flash", source: "environment" });
    vi.stubEnv("RESEARCH_MODEL_RESEARCH_CLAIM_EXTRACTOR", "qwen3.8-flash");
    expect(selectResearchModel("research.claim_extractor")).toMatchObject({ provider: "bailian", model: "qwen3.8-flash", reasoningEffort: "high", source: "environment" });
    vi.stubEnv("RESEARCH_MODEL_RESEARCH_PLANNER", "unknown-model");
    expect(() => selectResearchModel("research.planner")).toThrow(
      "RESEARCH_MODEL_RESEARCH_PLANNER"
    );
  });
});
