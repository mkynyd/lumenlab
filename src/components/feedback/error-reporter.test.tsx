import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorReporter } from "@/components/feedback/error-reporter";

describe("ErrorReporter", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 204 }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports window error events", () => {
    render(<ErrorReporter />);
    const error = new Error("Boom");
    window.dispatchEvent(new ErrorEvent("error", { message: "Boom", error }));

    expect(fetch).toHaveBeenCalledWith(
      "/api/errors/report",
      expect.objectContaining({ method: "POST", keepalive: true })
    );
    const body = JSON.parse(
      (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string
    );
    expect(body.message).toBe("Boom");
    expect(body.route).toBe(window.location.pathname);
  });

  it("reports unhandled promise rejections", () => {
    render(<ErrorReporter />);
    // jsdom 没有 PromiseRejectionEvent 构造器，用普通 Event 挂 reason 属性代替。
    // promise 参数用 Promise.resolve()，避免触发 jsdom 自身的 unhandled rejection 噪音。
    const event = new Event("unhandledrejection") as PromiseRejectionEvent;
    Object.defineProperty(event, "promise", { value: Promise.resolve() });
    Object.defineProperty(event, "reason", { value: new Error("async boom") });
    window.dispatchEvent(event);

    const body = JSON.parse(
      (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string
    );
    expect(body.message).toBe("async boom");
  });

  it("dedupes identical errors within a session", () => {
    render(<ErrorReporter />);
    const error = new Error("Same");
    window.dispatchEvent(new ErrorEvent("error", { message: "Same", error }));
    window.dispatchEvent(new ErrorEvent("error", { message: "Same", error }));

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("swallows reporting network failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<ErrorReporter />);
    window.dispatchEvent(
      new ErrorEvent("error", { message: "Boom", error: new Error("Boom") })
    );
    // 不抛出即通过
    await Promise.resolve();
  });
});
