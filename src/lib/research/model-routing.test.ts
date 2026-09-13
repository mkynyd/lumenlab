import { afterEach, describe, expect, it, vi } from "vitest";
import { researchModelConfiguration, resolveCommanderModel, selectResearchModel } from "./model-routing";

describe("research model routing", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("routes all default roles through the active DeepSeek Responses model", () => {
    expect(selectResearchModel("research.worker")).toMatchObject({ provider: "deepseek", model: "deepseek-flash", source: "default" });
    expect(selectResearchModel("research.synthesizer")).toMatchObject({ provider: "deepseek", model: "deepseek-flash", reasoningEffort: "max" });
    expect(selectResearchModel("research.claim_extractor")).toMatchObject({ provider: "deepseek", model: "deepseek-flash", reasoningEffort: "high" });
    // 视觉证据复用同一活跃多模态模型，thinking 由 model-stage 统一关闭。
    expect(selectResearchModel("research.visual_evaluator")).toMatchObject({ provider: "deepseek", model: "deepseek-flash", reasoningEffort: "high" });
  });

  it("exposes all role assignments as structured configuration", () => {
    const configuration = researchModelConfiguration();
    expect(Object.keys(configuration)).toHaveLength(7);
    expect(configuration["research.verifier"].role).toBe("research.verifier");
    expect(configuration["research.claim_extractor"].role).toBe("research.claim_extractor");
    expect(configuration["research.visual_evaluator"].role).toBe("research.visual_evaluator");
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

  it("prefers the per-run override over environment and default routing", () => {
    expect(selectResearchModel("research.worker", "qwen3.8-max")).toMatchObject({ provider: "bailian", model: "qwen3.8-max", source: "run_override" });
    vi.stubEnv("RESEARCH_MODEL_RESEARCH_WORKER", "minimax-m3");
    expect(selectResearchModel("research.worker", "qwen3.8-max")).toMatchObject({ provider: "bailian", model: "qwen3.8-max", source: "run_override" });
    expect(selectResearchModel("research.worker", null)).toMatchObject({ provider: "minimax", model: "minimax-m3", source: "environment" });
  });

  it("keeps role reasoning rules under the per-run override", () => {
    expect(selectResearchModel("research.synthesizer", "qwen3.8-max")).toMatchObject({ model: "qwen3.8-max", reasoningEffort: "max" });
    expect(selectResearchModel("research.visual_evaluator", "qwen3.8-max")).toMatchObject({ model: "qwen3.8-max", reasoningEffort: "high" });
    const configuration = researchModelConfiguration("qwen3.8-max");
    expect(Object.values(configuration).every((selection) => selection.source === "run_override" && selection.model === "qwen3.8-max")).toBe(true);
    expect(configuration["research.synthesizer"].reasoningEffort).toBe("max");
  });

  it("accepts only active catalog models as commander model", () => {
    expect(resolveCommanderModel("qwen3.8-max")).toBe("qwen3.8-max");
    expect(resolveCommanderModel("deepseek-flash")).toBe("deepseek-flash");
    // 历史别名、未知 ID 与非字符串一律拒绝，不走 legacy 升级。
    expect(resolveCommanderModel("qwen3.7-plus")).toBeNull();
    expect(resolveCommanderModel("unknown-model")).toBeNull();
    expect(resolveCommanderModel(null)).toBeNull();
    expect(resolveCommanderModel(undefined)).toBeNull();
    expect(resolveCommanderModel(42)).toBeNull();
  });
});
