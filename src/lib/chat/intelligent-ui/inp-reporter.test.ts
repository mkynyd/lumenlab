import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ onINP: vi.fn() }));

vi.mock("web-vitals", () => ({ onINP: mocks.onINP }));

describe("chat INP reporter", () => {
  let beacon: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    beacon = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: beacon });
    Object.defineProperty(navigator, "webdriver", { configurable: true, value: false });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })),
    });
    mocks.onINP.mockImplementation(() => {});
  });

  it("reports one anonymous page sample after web-vitals finalizes the metric", async () => {
    let report: ((metric: { id: string; value: number }) => void) | undefined;
    mocks.onINP.mockImplementation((callback: typeof report) => {
      report = callback;
    });
    const { startChatInpReporter } = await import("./inp-reporter");
    startChatInpReporter();
    await vi.waitFor(() => expect(report).toBeTypeOf("function"));

    report!({ id: "metric-1", value: 123.6 });

    expect(beacon).toHaveBeenCalledTimes(1);
    expect(beacon.mock.calls[0][0]).toBe("/api/chat/metrics/inp");
    expect(JSON.parse(beacon.mock.calls[0][1])).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      day: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      screen: "wide",
      ms: 124,
    });
    expect(mocks.onINP).toHaveBeenCalledWith(expect.any(Function), { reportAllChanges: false });
  });

  it("reuses the visit id when web-vitals refines the same metric", async () => {
    let report: ((metric: { id: string; value: number }) => void) | undefined;
    mocks.onINP.mockImplementation((callback: typeof report) => {
      report = callback;
    });
    const { startChatInpReporter } = await import("./inp-reporter");
    startChatInpReporter();
    await vi.waitFor(() => expect(report).toBeTypeOf("function"));

    report!({ id: "metric-1", value: 80 });
    report!({ id: "metric-1", value: 160 });
    report!({ id: "metric-2", value: 90 });

    const samples = beacon.mock.calls.map(([, body]) => JSON.parse(body));
    expect(samples[0].id).toBe(samples[1].id);
    expect(samples[0].ms).toBe(80);
    expect(samples[1].ms).toBe(160);
    expect(samples[2].id).not.toBe(samples[0].id);
  });

  it("labels narrow screens and starts only once", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} })),
    });
    let report: ((metric: { id: string; value: number }) => void) | undefined;
    mocks.onINP.mockImplementation((callback: typeof report) => {
      report = callback;
    });
    const { startChatInpReporter } = await import("./inp-reporter");
    startChatInpReporter();
    startChatInpReporter();
    await vi.waitFor(() => expect(report).toBeTypeOf("function"));

    report!({ id: "metric-1", value: 50 });
    expect(mocks.onINP).toHaveBeenCalledTimes(1);
    expect(JSON.parse(beacon.mock.calls[0][1]).screen).toBe("narrow");
  });

  it("does nothing when the browser cannot send a beacon", async () => {
    Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: undefined });
    const { startChatInpReporter } = await import("./inp-reporter");
    startChatInpReporter();
    expect(mocks.onINP).not.toHaveBeenCalled();
  });

  it("does nothing in webdriver sessions", async () => {
    Object.defineProperty(navigator, "webdriver", { configurable: true, value: true });
    const { startChatInpReporter } = await import("./inp-reporter");
    startChatInpReporter();
    expect(mocks.onINP).not.toHaveBeenCalled();
  });
});
