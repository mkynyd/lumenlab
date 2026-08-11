import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: { errorEvent: { upsert: mocks.upsert } },
}));

import { computeErrorDigest, recordErrorEvent, recordServerError } from "@/lib/feedback/events";

describe("computeErrorDigest", () => {
  it("is stable for identical input", () => {
    const input = { source: "client", message: "Boom", stack: "Error: Boom\n  at a.ts:1", route: "/chat" };
    expect(computeErrorDigest(input)).toBe(computeErrorDigest(input));
    expect(computeErrorDigest(input)).toHaveLength(16);
  });

  it("ignores stack lines beyond the first", () => {
    const a = computeErrorDigest({ source: "client", message: "Boom", stack: "Error: Boom\n  at a.ts:1", route: "/chat" });
    const b = computeErrorDigest({ source: "client", message: "Boom", stack: "Error: Boom\n  at b.ts:2", route: "/chat" });
    expect(a).toBe(b);
  });

  it("differs by message / source / route", () => {
    const base = { source: "client", message: "Boom", stack: "", route: "/chat" };
    expect(computeErrorDigest(base)).not.toBe(computeErrorDigest({ ...base, message: "Other" }));
    expect(computeErrorDigest(base)).not.toBe(computeErrorDigest({ ...base, source: "server" }));
    expect(computeErrorDigest(base)).not.toBe(computeErrorDigest({ ...base, route: "/projects" }));
  });
});

describe("recordErrorEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.upsert.mockResolvedValue({});
  });

  it("upserts by digest with count increment and truncates fields", async () => {
    await recordErrorEvent({
      source: "client",
      message: "x".repeat(600),
      stack: "y".repeat(5000),
      route: "/chat",
      userId: "u1",
      userAgent: "UA",
    });

    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    const arg = mocks.upsert.mock.calls[0][0];
    expect(arg.where.digest).toHaveLength(16);
    expect(arg.update.count).toEqual({ increment: 1 });
    expect(arg.create.message).toHaveLength(500);
    expect(arg.create.stack).toHaveLength(4000);
    expect(arg.create.count).toBe(1);
    expect(arg.create.userId).toBe("u1");
  });
});

describe("recordServerError", () => {
  beforeEach(() => vi.clearAllMocks());

  it("records an Error instance as server source", async () => {
    mocks.upsert.mockResolvedValue({});
    await recordServerError(new Error("db down"), "/api/chat");
    const arg = mocks.upsert.mock.calls[0][0];
    expect(arg.create.source).toBe("server");
    expect(arg.create.message).toBe("db down");
    expect(arg.create.route).toBe("/api/chat");
  });

  it("never throws when the database write fails", async () => {
    mocks.upsert.mockRejectedValue(new Error("db gone"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(recordServerError(new Error("boom"), null)).resolves.toBeUndefined();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
