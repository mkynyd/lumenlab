import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHAT_INP_RETENTION_DAYS, chatInpKey, utcDay } from "@/lib/chat/intelligent-ui/inp-metrics";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  checkRateLimit: vi.fn(),
  zadd: vi.fn(),
  expireat: vi.fn(),
  exec: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...original, checkRateLimit: mocks.checkRateLimit };
});
vi.mock("@/lib/redis", () => ({
  getRedis: () => ({
    multi: () => {
      const pipeline = {
        zadd: (...args: unknown[]) => {
          mocks.zadd(...args);
          return pipeline;
        },
        expireat: (...args: unknown[]) => {
          mocks.expireat(...args);
          return pipeline;
        },
        exec: mocks.exec,
      };
      return pipeline;
    },
  }),
}));

import { POST } from "@/app/api/chat/metrics/inp/route";

const ORIGIN = "http://localhost";
const VALID_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new NextRequest(`${ORIGIN}/api/chat/metrics/inp`, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8", Origin: ORIGIN, ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );
}

function validBody(overrides: Record<string, unknown> = {}) {
  return { id: VALID_ID, day: utcDay(), screen: "wide", ms: 123, ...overrides };
}

describe("POST /api/chat/metrics/inp", () => {
  const originalAuthUrl = process.env.AUTH_URL;
  const originalRender = process.env.CHAT_INTELLIGENT_UI_RENDER;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AUTH_URL = ORIGIN;
    delete process.env.CHAT_INTELLIGENT_UI_RENDER;
    mocks.auth.mockResolvedValue({ user: { id: "u1" } });
    mocks.checkRateLimit.mockResolvedValue({ allowed: true, remaining: 59, resetTime: 0 });
    mocks.exec.mockResolvedValue([]);
  });

  afterEach(() => {
    if (originalAuthUrl === undefined) delete process.env.AUTH_URL;
    else process.env.AUTH_URL = originalAuthUrl;
    if (originalRender === undefined) delete process.env.CHAT_INTELLIGENT_UI_RENDER;
    else process.env.CHAT_INTELLIGENT_UI_RENDER = originalRender;
  });

  it("stores one anonymous score per visit in the day/screen sorted set", async () => {
    const body = validBody();
    const response = await post(body);
    expect(response.status).toBe(204);
    expect(mocks.zadd).toHaveBeenCalledWith(chatInpKey(body.day, "wide"), 123, VALID_ID);
    expect(mocks.expireat).toHaveBeenCalledWith(
      chatInpKey(body.day, "wide"),
      Math.floor(Date.parse(body.day) / 1000) + CHAT_INP_RETENTION_DAYS * 86_400
    );
    expect(mocks.exec).toHaveBeenCalled();
    expect(mocks.checkRateLimit).toHaveBeenCalledWith("chat-inp:u1", 60, 3_600_000);
  });

  it("drops reports from another origin", async () => {
    const response = await post(validBody(), { Origin: "https://evil.example" });
    expect(response.status).toBe(204);
    expect(mocks.zadd).not.toHaveBeenCalled();
  });

  it("drops reports without an origin header", async () => {
    const response = await post(validBody(), { Origin: "" });
    expect(response.status).toBe(204);
    expect(mocks.zadd).not.toHaveBeenCalled();
  });

  it("drops anonymous reports", async () => {
    mocks.auth.mockResolvedValue(null);
    const response = await post(validBody());
    expect(response.status).toBe(204);
    expect(mocks.zadd).not.toHaveBeenCalled();
  });

  it("drops reports after the per-user limit", async () => {
    mocks.checkRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetTime: 0 });
    const response = await post(validBody());
    expect(response.status).toBe(204);
    expect(mocks.zadd).not.toHaveBeenCalled();
  });

  it("drops reports when rendering is disabled", async () => {
    process.env.CHAT_INTELLIGENT_UI_RENDER = "0";
    const response = await post(validBody());
    expect(response.status).toBe(204);
    expect(mocks.zadd).not.toHaveBeenCalled();
  });

  it("rejects malformed payloads without touching Redis", async () => {
    for (const body of [
      validBody({ id: "predictable" }),
      validBody({ day: "23/11/2026" }),
      validBody({ screen: "tablet" }),
      validBody({ ms: 60_001 }),
      validBody({ ms: 1.5 }),
      validBody({ extra: true }),
    ]) {
      expect((await post(body)).status).toBe(204);
    }
    expect(mocks.zadd).not.toHaveBeenCalled();
  });

  it("rejects future or expired UTC days", async () => {
    const tomorrow = utcDay(new Date(Date.now() + 86_400_000));
    const tooOld = utcDay(new Date(Date.now() - CHAT_INP_RETENTION_DAYS * 86_400_000));
    expect((await post(validBody({ day: tomorrow }))).status).toBe(204);
    expect((await post(validBody({ day: tooOld }))).status).toBe(204);
    expect(mocks.zadd).not.toHaveBeenCalled();
  });

  it("rejects bodies over the 256-byte budget", async () => {
    const oversized = JSON.stringify(validBody()) + " ".repeat(300);
    expect((await post(oversized)).status).toBe(204);
    expect(mocks.zadd).not.toHaveBeenCalled();
  });

  it("still returns 204 when Redis fails", async () => {
    mocks.exec.mockRejectedValue(new Error("redis down"));
    const response = await post(validBody());
    expect(response.status).toBe(204);
  });

  it("returns 204 when authentication throws", async () => {
    mocks.auth.mockRejectedValue(new Error("auth down"));
    const response = await post(validBody());
    expect(response.status).toBe(204);
  });
});
