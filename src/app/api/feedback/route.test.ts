import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  checkRateLimit: vi.fn(),
  feedbackCreate: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...original, checkRateLimit: mocks.checkRateLimit };
});
vi.mock("@/lib/db", () => ({
  prisma: { feedback: { create: mocks.feedbackCreate } },
}));

import { POST } from "@/app/api/feedback/route";

function post(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json", "user-agent": "TestUA" },
      body: JSON.stringify(body),
    })
  );
}

const validBody = { category: "bug", content: "导出 PDF 时卡住", contact: "qq 123", pagePath: "/chat" };

describe("POST /api/feedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "u1" } });
    mocks.checkRateLimit.mockResolvedValue({ allowed: true, remaining: 19, resetTime: 0 });
    mocks.feedbackCreate.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
      id: "fb-1",
      ...data,
    }));
  });

  it("creates feedback for logged-in users", async () => {
    const response = await post(validBody);
    expect(response.status).toBe(201);
    expect(mocks.feedbackCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "u1",
        category: "bug",
        content: "导出 PDF 时卡住",
        pagePath: "/chat",
        userAgent: "TestUA",
      }),
    });
  });

  it("returns 401 when not logged in", async () => {
    mocks.auth.mockResolvedValue(null);
    const response = await post(validBody);
    expect(response.status).toBe(401);
    expect(mocks.feedbackCreate).not.toHaveBeenCalled();
  });

  it("returns 429 when daily limit exceeded", async () => {
    mocks.checkRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetTime: 0 });
    const response = await post(validBody);
    expect(response.status).toBe(429);
    expect(mocks.checkRateLimit).toHaveBeenCalledWith("feedback:u1", 20, 86_400_000);
  });

  it("returns 400 for invalid category or empty content", async () => {
    expect((await post({ ...validBody, category: "spam" })).status).toBe(400);
    expect((await post({ ...validBody, content: "" })).status).toBe(400);
    expect(mocks.feedbackCreate).not.toHaveBeenCalled();
  });

  it("returns 400 for content over 2000 chars", async () => {
    const response = await post({ ...validBody, content: "x".repeat(2001) });
    expect(response.status).toBe(400);
  });
});
