import { describe, expect, it } from "vitest";
import { addResearchUsage, EMPTY_RESEARCH_USAGE } from "./accounting";

describe("research usage accounting", () => {
  it("accumulates runtime usage and model-weighted credits", () => {
    expect(addResearchUsage(EMPTY_RESEARCH_USAGE, {
      promptTokens: 2_000,
      completionTokens: 1_000,
      totalTokens: 3_000,
      promptCacheHitTokens: 500,
      promptCacheMissTokens: 1_500,
    }, "deepseek-v4-pro")).toEqual({
      promptTokens: 2_000,
      completionTokens: 1_000,
      totalTokens: 3_000,
      costCredits: 11,
    });
  });

  it("does not mutate the prior checkpoint totals when no usage exists", () => {
    expect(addResearchUsage({ ...EMPTY_RESEARCH_USAGE, totalTokens: 4 }, null, "deepseek-v4-flash")).toEqual({ ...EMPTY_RESEARCH_USAGE, totalTokens: 4 });
  });
});
