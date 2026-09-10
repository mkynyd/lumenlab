import { describe, it, expect } from "vitest";
import {
  calculateCredits,
  deepSeekBillingTier,
  estimateCreditsForBudget,
  getCreditWeights,
  UnknownModelCreditError,
  CREDIT_WEIGHTS,
} from "./credits";

// 2026-09-07 是周一，2026-09-12/13 是周六/周日（Asia/Shanghai）
const MONDAY = (time: string) => new Date(`2026-09-07T${time}:00+08:00`);
const SATURDAY = (time: string) => new Date(`2026-09-12T${time}:00+08:00`);

describe("credits", () => {
  it("returns weights for known models", () => {
    expect(getCreditWeights("deepseek-v4-flash")).toBeDefined();
    expect(getCreditWeights("deepseek-v4-pro")).toBeDefined();
    expect(getCreditWeights("minimax-m3")).toBeDefined();
    expect(getCreditWeights("qwen3.7-plus")).toBeDefined();
    expect(getCreditWeights("qwen3.8-flash")).toBeDefined();
    expect(getCreditWeights("deepseek-flash")).toBeDefined();
    expect(getCreditWeights("deepseek-v4-flash-vision-exp")).toBeDefined();
    expect(getCreditWeights("unknown")).toBeUndefined();
  });

  it("keeps historical model weights unchanged", () => {
    expect(CREDIT_WEIGHTS["deepseek-v4-flash"]).toEqual({
      hit: 0.02,
      miss: 1,
      out: 2,
    });
    expect(CREDIT_WEIGHTS["deepseek-v4-pro"]).toEqual({
      hit: 0.025,
      miss: 3,
      out: 6,
    });
    expect(CREDIT_WEIGHTS["minimax-m3"]).toEqual({
      hit: 0.42,
      miss: 2.1,
      out: 8.4,
    });
    expect(CREDIT_WEIGHTS["qwen3.7-plus"]).toEqual({
      hit: 0.2,
      miss: 2,
      out: 8,
    });
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

  it("calculates credits for qwen3.8-flash with its own flat weights", () => {
    // hit 0.1 / miss 0.8 / out 2.7（元/百万 → 每 1K 信用点）
    const credits = calculateCredits("qwen3.8-flash", {
      inputCacheHitTokens: 1_000,
      inputCacheMissTokens: 1_000,
      outputTokens: 1_000,
    });
    // 100 + 800 + 2700 = 3600 raw / 1000 = 3.6 → 4
    expect(credits).toBe(4);
  });

  it("does not apply the qwen3.7-plus long-context tier to qwen3.8-flash", () => {
    const credits = calculateCredits("qwen3.8-flash", {
      inputCacheHitTokens: 0,
      inputCacheMissTokens: 300_000,
      outputTokens: 1_000,
    });
    // 300000 * 0.8 + 1000 * 2.7 = 242700 raw / 1000 = 242.7 → 243
    expect(credits).toBe(243);
  });

  it("rounds credits up", () => {
    const credits = calculateCredits("deepseek-v4-flash", {
      inputCacheHitTokens: 0,
      inputCacheMissTokens: 1,
      outputTokens: 0,
    });
    expect(credits).toBe(1);
  });

  it("does not let binary float noise add an extra credit on round totals", () => {
    // 1M 命中 + 1M 未命中 + 1M 输出（低谷）：0.02 + 1 + 4 = 5.02 元 = 5020 信用点
    const credits = calculateCredits("deepseek-flash", {
      inputCacheHitTokens: 1_000_000,
      inputCacheMissTokens: 1_000_000,
      outputTokens: 1_000_000,
    }, { requestStartedAt: SATURDAY("10:00") });
    expect(credits).toBe(5_020);
  });

  it("throws for unknown models instead of settling for free", () => {
    expect(() =>
      calculateCredits("unknown", {
        inputCacheHitTokens: 0,
        inputCacheMissTokens: 1000,
        outputTokens: 1000,
      })
    ).toThrow(UnknownModelCreditError);
    expect(() =>
      calculateCredits("unknown", {
        inputCacheHitTokens: 0,
        inputCacheMissTokens: 1000,
        outputTokens: 1000,
      })
    ).toThrow("unknown");
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

describe("deepSeekBillingTier", () => {
  it("treats weekday 9:00-12:00 and 14:00-18:00 (Asia/Shanghai) as peak", () => {
    expect(deepSeekBillingTier(MONDAY("08:59"))).toBe("off_peak");
    expect(deepSeekBillingTier(MONDAY("09:00"))).toBe("peak");
    expect(deepSeekBillingTier(MONDAY("11:59"))).toBe("peak");
    expect(deepSeekBillingTier(MONDAY("12:00"))).toBe("off_peak");
    expect(deepSeekBillingTier(MONDAY("13:59"))).toBe("off_peak");
    expect(deepSeekBillingTier(MONDAY("14:00"))).toBe("peak");
    expect(deepSeekBillingTier(MONDAY("17:59"))).toBe("peak");
    expect(deepSeekBillingTier(MONDAY("18:00"))).toBe("off_peak");
  });

  it("treats weekends as off-peak all day", () => {
    expect(deepSeekBillingTier(SATURDAY("09:00"))).toBe("off_peak");
    expect(deepSeekBillingTier(SATURDAY("14:00"))).toBe("off_peak");
    expect(deepSeekBillingTier(new Date("2026-09-13T10:00:00+08:00"))).toBe(
      "off_peak"
    );
  });

  it("uses Asia/Shanghai regardless of the runtime timezone", () => {
    // 2026-09-07T01:00:00Z = 周一 09:00 Asia/Shanghai
    expect(deepSeekBillingTier(new Date("2026-09-07T01:00:00Z"))).toBe("peak");
    // 2026-09-07T04:00:00Z = 周一 12:00 Asia/Shanghai（恰出高峰）
    expect(deepSeekBillingTier(new Date("2026-09-07T04:00:00Z"))).toBe("off_peak");
    // 2026-09-11T16:00:00Z = 周六 00:00 Asia/Shanghai
    expect(deepSeekBillingTier(new Date("2026-09-11T16:00:00Z"))).toBe("off_peak");
  });
});

describe("deepseek-flash peak/off-peak pricing", () => {
  const usage = {
    inputCacheHitTokens: 1_000,
    inputCacheMissTokens: 1_000,
    outputTokens: 1_000,
  };

  it("uses the 2026-09-10 V4.1 Flash off-peak weights", () => {
    expect(getCreditWeights("deepseek-flash", "off_peak")).toEqual({
      hit: 0.02,
      miss: 1,
      out: 4,
    });
    // 1000*0.02 + 1000*1 + 1000*4 = 5020 raw / 1000 = 5.02 → 6
    expect(
      calculateCredits("deepseek-flash", usage, {
        requestStartedAt: MONDAY("08:00"),
      })
    ).toBe(6);
  });

  it("charges peak weights inside peak windows, frozen at request start", () => {
    // 高峰为低谷两倍：1000*0.04 + 1000*2 + 1000*8 = 10040 raw / 1000 = 10.04 → 11
    expect(
      calculateCredits("deepseek-flash", usage, {
        requestStartedAt: MONDAY("10:00"),
      })
    ).toBe(11);
  });

  it("freezes the tier at request start even across a boundary", () => {
    // 11:59 开始的请求按高峰结算，不按结算时刻重算
    expect(
      calculateCredits("deepseek-flash", usage, {
        requestStartedAt: MONDAY("11:59"),
      })
    ).toBe(11);
    // 12:00 开始的请求按低谷结算
    expect(
      calculateCredits("deepseek-flash", usage, {
        requestStartedAt: MONDAY("12:00"),
      })
    ).toBe(6);
  });

  it("falls back to off-peak when no start time is provided", () => {
    expect(calculateCredits("deepseek-flash", usage)).toBe(6);
  });

  it("ignores the tier for non-DeepSeek models", () => {
    const atPeak = { requestStartedAt: MONDAY("10:00") };
    expect(calculateCredits("minimax-m3", usage, atPeak)).toBe(
      calculateCredits("minimax-m3", usage, {
        requestStartedAt: SATURDAY("10:00"),
      })
    );
    expect(calculateCredits("qwen3.8-flash", usage, atPeak)).toBe(4);
  });

  it("estimates budget with the same frozen tier", () => {
    // 高峰：2000*2 + 1000*8 = 12000 / 1000 = 12
    expect(
      estimateCreditsForBudget("deepseek-flash", 2000, 1000, {
        requestStartedAt: MONDAY("10:00"),
      })
    ).toBe(12);
    // 低谷：2000*1 + 1000*4 = 6000 / 1000 = 6
    expect(
      estimateCreditsForBudget("deepseek-flash", 2000, 1000, {
        requestStartedAt: SATURDAY("10:00"),
      })
    ).toBe(6);
  });
});

describe("historical DeepSeek pricing stays frozen", () => {
  it("keeps V4 Flash Vision Exp on its original peak/off-peak rates", () => {
    const usage = {
      inputCacheHitTokens: 1_000,
      inputCacheMissTokens: 1_000,
      outputTokens: 1_000,
    };
    expect(getCreditWeights("deepseek-v4-flash-vision-exp", "off_peak")).toEqual({
      hit: 0.05,
      miss: 1.5,
      out: 4.5,
    });
    expect(getCreditWeights("deepseek-v4-flash-vision-exp", "peak")).toEqual({
      hit: 0.1,
      miss: 3,
      out: 9,
    });
    // 1000*0.05 + 1000*1.5 + 1000*4.5 = 6050 raw / 1000 = 6.05 → 7
    expect(
      calculateCredits("deepseek-v4-flash-vision-exp", usage, {
        requestStartedAt: SATURDAY("10:00"),
      })
    ).toBe(7);
    expect(
      calculateCredits("deepseek-v4-flash-vision-exp", usage, {
        requestStartedAt: MONDAY("10:00"),
      })
    ).toBe(13);
  });

  it("keeps legacy V4 Flash and V4 Pro on their flat rates", () => {
    expect(calculateCredits("deepseek-v4-flash", {
      inputCacheHitTokens: 0,
      inputCacheMissTokens: 1000,
      outputTokens: 1000,
    })).toBe(3);
    expect(calculateCredits("deepseek-v4-pro", {
      inputCacheHitTokens: 0,
      inputCacheMissTokens: 1000,
      outputTokens: 1000,
    })).toBe(9);
  });
});
