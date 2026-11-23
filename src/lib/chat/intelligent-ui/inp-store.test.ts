import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ zrange: vi.fn() }));

vi.mock("@/lib/redis", () => ({
  getRedis: () => ({ zrange: mocks.zrange }),
}));

import { getChatInpReport } from "./inp-store";

describe("chat INP report", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.zrange.mockResolvedValue([]);
  });

  it("aggregates samples per day and per screen with nearest-rank percentiles", async () => {
    mocks.zrange.mockImplementation((key: string) => {
      if (key === "lumenlab:chat-inp:v1:2026-11-23:wide") {
        return Promise.resolve(["a", "80", "b", "100", "c", "120", "d", "200"]);
      }
      if (key === "lumenlab:chat-inp:v1:2026-11-22:narrow") {
        return Promise.resolve(["e", "60", "f", "90"]);
      }
      return Promise.resolve([]);
    });

    const report = await getChatInpReport(2, new Date("2026-11-23T12:00:00Z"));

    expect(report.days).toBe(2);
    expect(report.untilDay).toBe("2026-11-23");
    expect(report.sinceDay).toBe("2026-11-22");
    expect(report.screens.wide).toEqual({ count: 4, p50: 100, p75: 120, p95: 200 });
    expect(report.screens.narrow).toEqual({ count: 2, p50: 60, p75: 90, p95: 90 });
    expect(report.groups).toEqual([
      { day: "2026-11-23", screen: "wide", count: 4, p50: 100, p75: 120, p95: 200 },
      { day: "2026-11-22", screen: "narrow", count: 2, p50: 60, p75: 90, p95: 90 },
    ]);
  });

  it("returns an empty report when no traffic was sampled", async () => {
    const report = await getChatInpReport(7, new Date("2026-11-23T12:00:00Z"));
    expect(report.groups).toEqual([]);
    expect(report.screens).toEqual({
      narrow: { count: 0, p50: null, p75: null, p95: null },
      wide: { count: 0, p50: null, p75: null, p95: null },
    });
  });

  it("clamps the requested window to the retention period", async () => {
    const report = await getChatInpReport(30, new Date("2026-11-23T12:00:00Z"));
    expect(report.days).toBe(14);
    expect(report.sinceDay).toBe("2026-11-10");
  });

  it("fails the report when Redis is unreachable", async () => {
    mocks.zrange.mockRejectedValue(new Error("redis down"));
    await expect(getChatInpReport(1, new Date("2026-11-23T12:00:00Z"))).rejects.toThrow("redis down");
  });
});
