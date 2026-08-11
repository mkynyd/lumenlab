import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  checkRateLimit: vi.fn(),
  recordErrorEvent: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...original, checkRateLimit: mocks.checkRateLimit };
});
vi.mock("@/lib/feedback/events", () => ({
  recordErrorEvent: mocks.recordErrorEvent,
}));

import { POST } from "@/app/api/errors/report/route";

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new NextRequest("http://localhost/api/errors/report", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    })
  );
}

const validBody = { message: "ChunkLoadError", stack: "Error: ChunkLoadError\n  at x.ts:1", route: "/chat" };

describe("POST /api/errors/report", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue(null);
    mocks.checkRateLimit.mockResolvedValue({ allowed: true, remaining: 29, resetTime: 0 });
    mocks.recordErrorEvent.mockResolvedValue(undefined);
  });

  it("records anonymous client errors with 204", async () => {
    const response = await post(validBody, { "x-forwarded-for": "1.2.3.4" });
    expect(response.status).toBe(204);
    expect(mocks.recordErrorEvent).toHaveBeenCalledWith(
      expect.objectContaining({ source: "client", message: "ChunkLoadError", route: "/chat", userId: null })
    );
    expect(mocks.checkRateLimit).toHaveBeenCalledWith("error-report:1.2.3.4", 30, 60_000);
  });

  it("attaches userId when logged in", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "u1" } });
    await post(validBody);
    expect(mocks.recordErrorEvent).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1" }));
  });

  it("drops silently with 204 when rate limited", async () => {
    mocks.checkRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetTime: 0 });
    const response = await post(validBody);
    expect(response.status).toBe(204);
    expect(mocks.recordErrorEvent).not.toHaveBeenCalled();
  });

  it("returns 204 without recording for invalid payloads", async () => {
    const response = await post({ message: "" });
    expect(response.status).toBe(204);
    expect(mocks.recordErrorEvent).not.toHaveBeenCalled();
  });

  it("returns 204 even when recording throws", async () => {
    mocks.recordErrorEvent.mockRejectedValue(new Error("db gone"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await post(validBody);
    expect(response.status).toBe(204);
    consoleSpy.mockRestore();
  });
});
