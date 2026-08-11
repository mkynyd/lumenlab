import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAdminUser: vi.fn(),
  findMany: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ getAdminUser: mocks.getAdminUser }));
vi.mock("@/lib/db", () => ({
  prisma: { errorEvent: { findMany: mocks.findMany, update: mocks.update } },
}));

import { GET } from "@/app/api/admin/errors/route";
import { PATCH } from "@/app/api/admin/errors/[id]/route";

describe("GET /api/admin/errors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAdminUser.mockResolvedValue({ id: "admin-1", email: "admin@example.com" });
    mocks.findMany.mockResolvedValue([{ id: "err-1", status: "open" }]);
  });

  it("returns 404 for non-admin", async () => {
    mocks.getAdminUser.mockResolvedValue(null);
    const response = await GET(new NextRequest("http://localhost/api/admin/errors"));
    expect(response.status).toBe(404);
  });

  it("lists error events ordered by lastSeenAt, optional status filter", async () => {
    const response = await GET(new NextRequest("http://localhost/api/admin/errors?status=ignored"));
    expect(response.status).toBe(200);
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "ignored" },
        orderBy: { lastSeenAt: "desc" },
        take: 100,
      })
    );
    const payload = await response.json();
    expect(payload.items).toHaveLength(1);
  });
});

describe("PATCH /api/admin/errors/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAdminUser.mockResolvedValue({ id: "admin-1", email: "admin@example.com" });
    mocks.update.mockResolvedValue({ id: "err-1", status: "ignored" });
  });

  it("updates status for admin", async () => {
    const response = await PATCH(
      new NextRequest("http://localhost/api/admin/errors/err-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "ignored" }),
      }),
      { params: Promise.resolve({ id: "err-1" }) }
    );
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "err-1" }, data: { status: "ignored" } });
  });

  it("rejects invalid status", async () => {
    const response = await PATCH(
      new NextRequest("http://localhost/api/admin/errors/err-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "banana" }),
      }),
      { params: Promise.resolve({ id: "err-1" }) }
    );
    expect(response.status).toBe(400);
  });
});
