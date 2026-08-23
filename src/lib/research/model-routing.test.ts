import { afterEach, describe, expect, it, vi } from "vitest";
import { researchModelConfiguration, selectResearchModel } from "./model-routing";

describe("research model routing", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("keeps workers on the lower-cost lane and synthesis on the stronger lane", () => {
    expect(selectResearchModel("research.worker")).toMatchObject({ provider: "deepseek", model: "deepseek-v4-flash", source: "default" });
    expect(selectResearchModel("research.synthesizer")).toMatchObject({ provider: "deepseek", model: "deepseek-v4-pro", reasoningEffort: "max" });
  });

  it("exposes all role assignments as structured configuration", () => {
    const configuration = researchModelConfiguration();
    expect(Object.keys(configuration)).toHaveLength(5);
    expect(configuration["research.verifier"].role).toBe("research.verifier");
  });

  it("allows a valid role-scoped environment override and rejects unknown models", () => {
    vi.stubEnv("RESEARCH_MODEL_RESEARCH_WORKER", "minimax-m3");
    expect(selectResearchModel("research.worker")).toMatchObject({ provider: "minimax", model: "minimax-m3", source: "environment" });
    vi.stubEnv("RESEARCH_MODEL_RESEARCH_VERIFIER", "unknown-model");
    expect(selectResearchModel("research.verifier")).toMatchObject({ provider: "deepseek", model: "deepseek-v4-pro", source: "default" });
  });
});
