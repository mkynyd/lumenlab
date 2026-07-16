import { describe, it, expect } from "vitest";
import {
  calculateCredits,
  estimateCreditsForBudget,
  getCreditWeights,
  CREDIT_WEIGHTS,
} from "./credits";

describe("credits", () => {
  it("returns weights for known models", () => {
    expect(getCreditWeights("deepseek-v4-flash")).toBeDefined();
    expect(getCreditWeights("deepseek-v4-pro")).toBeDefined();
    expect(getCreditWeights("minimax-m3")).toBeDefined();
    expect(getCreditWeights("qwen3.7-plus")).toBeDefined();
    expect(getCreditWeights("unknown")).toBeUndefined();
  });

  it("calculates credits for DeepSeek V4 Flash", () => {
    const credits = calculateCredits("deepseek-v4-flash", {
      inputCacheHitTokens: 0,
      inputCacheMissTokens: 1000,
      outputTokens: 1000,
    });
    // 1000 * 1 + 1000 * 2 = 3000 raw / 1000 = 3
    expect(credits).toBe(3);
  });

  it("calculates credits for DeepSeek V4 Pro", () => {
    const credits = calculateCredits("deepseek-v4-pro", {
      inputCacheHitTokens: 0,
      inputCacheMissTokens: 1000,
      outputTokens: 1000,
    });
    // 1000 * 3 + 1000 * 6 = 9000 raw / 1000 = 9
    expect(credits).toBe(9);
  });

  it("calculates credits for MiniMax M3", () => {
    const credits = calculateCredits("minimax-m3", {
      inputCacheHitTokens: 0,
      inputCacheMissTokens: 1000,
      outputTokens: 1000,
    });
    // 1000 * 2.1 + 1000 * 8.4 = 10500 raw / 1000 = 11 (ceil)
    expect(credits).toBe(11);
  });

  it("uses Qwen's documented higher price tier above 256K input tokens", () => {
    expect(calculateCredits("qwen3.7-plus", {
      inputCacheHitTokens: 0,
      inputCacheMissTokens: 1_000,
      outputTokens: 1_000,
    })).toBe(10);
    expect(calculateCredits("qwen3.7-plus", {
      inputCacheHitTokens: 0,
      inputCacheMissTokens: 300_000,
      outputTokens: 1_000,
    })).toBe(1_824);
  });

  it("rounds credits up", () => {
    const credits = calculateCredits("deepseek-v4-flash", {
      inputCacheHitTokens: 0,
      inputCacheMissTokens: 1,
      outputTokens: 0,
    });
    expect(credits).toBe(1);
  });

  it("returns 0 for unknown model", () => {
    const credits = calculateCredits("unknown", {
      inputCacheHitTokens: 0,
      inputCacheMissTokens: 1000,
      outputTokens: 1000,
    });
    expect(credits).toBe(0);
  });

  it("estimates credits for budget check", () => {
    const credits = estimateCreditsForBudget("deepseek-v4-flash", 2000, 1000);
    // 2000 * 1 + 1000 * 2 = 4000 / 1000 = 4
    expect(credits).toBe(4);
  });

  it("credit weights reflect relative cost ordering", () => {
    expect(CREDIT_WEIGHTS["deepseek-v4-pro"].out).toBeGreaterThan(
      CREDIT_WEIGHTS["deepseek-v4-flash"].out
    );
    expect(CREDIT_WEIGHTS["minimax-m3"].out).toBeGreaterThan(
      CREDIT_WEIGHTS["deepseek-v4-pro"].out
    );
  });
});
