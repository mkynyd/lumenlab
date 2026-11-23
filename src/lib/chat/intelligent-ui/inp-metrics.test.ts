import { describe, expect, it } from "vitest";
import {
  CHAT_INP_RETENTION_DAYS,
  chatInpKey,
  percentile,
  recentUtcDays,
  summarizeChatInp,
  utcDay,
} from "./inp-metrics";

describe("chat INP metric contract", () => {
  it("names one Redis sorted set per UTC day and screen", () => {
    expect(chatInpKey("2026-11-23", "narrow")).toBe("lumenlab:chat-inp:v1:2026-11-23:narrow");
    expect(chatInpKey("2026-11-23", "wide")).toBe("lumenlab:chat-inp:v1:2026-11-23:wide");
  });

  it("uses nearest-rank percentiles without interpolating outliers", () => {
    expect(percentile([], 0.75)).toBeNull();
    expect(percentile([120], 0.5)).toBe(120);
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(20);
    expect(percentile([10, 20, 30, 40], 0.75)).toBe(30);
    expect(percentile([10, 20, 30, 40], 0.95)).toBe(40);
    expect(percentile([40, 10, 30, 20], 0.5)).toBe(20);
  });

  it("summarizes an empty sample as unavailable rather than zero", () => {
    expect(summarizeChatInp([])).toEqual({ count: 0, p50: null, p75: null, p95: null });
  });

  it("keeps at most the retention window of UTC days, newest first", () => {
    const days = recentUtcDays(30, new Date("2026-11-23T12:00:00Z"));
    expect(days).toHaveLength(CHAT_INP_RETENTION_DAYS);
    expect(days[0]).toBe("2026-11-23");
    expect(days[1]).toBe("2026-11-22");
    expect(days.at(-1)).toBe("2026-11-10");
  });

  it("formats the UTC bucket from the visit instant", () => {
    expect(utcDay(new Date("2026-11-23T23:59:59Z"))).toBe("2026-11-23");
    expect(utcDay(new Date("2026-11-24T00:00:00Z"))).toBe("2026-11-24");
  });
});
