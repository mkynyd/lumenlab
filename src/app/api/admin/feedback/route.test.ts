import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAdminUser: vi.fn(),
  findMany: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ getAdminUser: mocks.getAdminUser }));
vi.mock("@/lib/db", () => ({
  prisma: { feedback: { findMany: mocks.findMany, update: mocks.update } },
}));

import { GET } from "@/app/api/admin/feedback/route";
import { PATCH } from "@/app/api/admin/feedback/[id]/route";

describe("GET /api/admin/feedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAdminUser.mockResolvedValue({ id: "admin-1", email: "admin@example.com" });
    mocks.findMany.mockResolvedValue([{ id: "fb-1", status: "open" }]);
  });

  it("returns 404 for non-admin", async () => {
    mocks.getAdminUser.mockResolvedValue(null);
    const response = await GET(new NextRequest("http://localhost/api/admin/feedback"));
    expect(response.status).toBe(404);
  });

  it("lists feedback with user email, optional status filter", async () => {
    const response = await GET(new NextRequest("http://localhost/api/admin/feedback?status=open"));
    expect(response.status).toBe(200);
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "open" }, take: 100 })
    );
    const payload = await response.json();
    expect(payload.items).toHaveLength(1);
  });
});

describe("PATCH /api/admin/feedback/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAdminUser.mockResolvedValue({ id: "admin-1", email: "admin@example.com" });
    mocks.update.mockResolvedValue({ id: "fb-1", status: "resolved" });
  });

  it("returns 404 for non-admin", async () => {
    mocks.getAdminUser.mockResolvedValue(null);
    const response = await PATCH(
      new NextRequest("http://localhost/api/admin/feedback/fb-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "resolved" }),
      }),
      { params: Promise.resolve({ id: "fb-1" }) }
    );
    expect(response.status).toBe(404);
  });

  it("updates status for admin", async () => {
    const response = await PATCH(
      new NextRequest("http://localhost/api/admin/feedback/fb-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "resolved" }),
      }),
      { params: Promise.resolve({ id: "fb-1" }) }
    );
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "fb-1" }, data: { status: "resolved" } });
  });

  it("rejects invalid status", async () => {
    const response = await PATCH(
      new NextRequest("http://localhost/api/admin/feedback/fb-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "banana" }),
      }),
      { params: Promise.resolve({ id: "fb-1" }) }
    );
    expect(response.status).toBe(400);
  });
});
