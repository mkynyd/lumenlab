import { describe, expect, it, vi } from "vitest";
import { createDiagnosticsReporter, isLiveSmokeEnabled, parseCliArgs, requireLiveSmoke } from "./live-diagnostics";

describe("live diagnostics helper", () => {
  it("defaults to disabled unless LUMENLAB_LIVE_SMOKE=1", () => {
    expect(isLiveSmokeEnabled({})).toBe(false);
    expect(isLiveSmokeEnabled({ LUMENLAB_LIVE_SMOKE: "0" })).toBe(false);
    expect(isLiveSmokeEnabled({ LUMENLAB_LIVE_SMOKE: "1" })).toBe(true);
  });

  it("requireLiveSmoke prints usage and blocks without opt-in", () => {
    const log = vi.fn();
    expect(requireLiveSmoke("demo", "npx tsx scripts/demo.ts", {}, log)).toBe(false);
    expect(log).toHaveBeenCalled();
    expect(log.mock.calls.flat().join(" ")).toContain("LUMENLAB_LIVE_SMOKE=1");
    expect(requireLiveSmoke("demo", "usage", { LUMENLAB_LIVE_SMOKE: "1" }, log)).toBe(true);
  });

  it("reporter emits stable [PASS]/[WARN]/[FAIL] lines and exit codes", () => {
    const lines: string[] = [];
    const reporter = createDiagnosticsReporter("demo", (line) => lines.push(line));
    reporter.pass("ok check");
    reporter.warn("transient degradation");
    expect(reporter.exitCode()).toBe(0);
    reporter.fail("correctness failure");
    expect(reporter.exitCode()).toBe(2);
    expect(lines[0]).toBe("[PASS] ok check");
    expect(lines[1]).toBe("[WARN] transient degradation");
    expect(lines[2]).toBe("[FAIL] correctness failure");
    expect(reporter.summarize()).toBe(2);
    expect(reporter.counts()).toEqual({ passed: 1, warned: 1, failed: 1 });
  });

  it("truncates long detail payloads so raw content never floods output", () => {
    const lines: string[] = [];
    const reporter = createDiagnosticsReporter("demo", (line) => lines.push(line));
    reporter.pass("bounded", { blob: "x".repeat(5000) });
    expect(lines[0].length).toBeLessThan(700);
    expect(lines[0]).toContain("…");
  });

  it("parses --flag and --key value CLI arguments", () => {
    const { flags, values } = parseCliArgs(["--with-arxiv", "--run", "run-123"]);
    expect(flags.has("with-arxiv")).toBe(true);
    expect(values.get("run")).toBe("run-123");
  });
});
