import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findMany: vi.fn(),
  findFirst: vi.fn(),
  delete: vi.fn(),
  deleteStoredObjects: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({
  prisma: {
    documentConversion: {
      findMany: mocks.findMany,
      findFirst: mocks.findFirst,
      delete: mocks.delete,
    },
  },
}));
vi.mock("@/lib/conversions/assets", () => ({
  deleteStoredObjects: mocks.deleteStoredObjects,
}));

import { GET as listConversions } from "@/app/api/tools/conversions/route";
import {
  DELETE as deleteConversion,
  GET as getConversion,
} from "@/app/api/tools/conversions/[id]/route";

describe("document conversion record routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
  });

  it("rejects unauthenticated list requests", async () => {
    mocks.auth.mockResolvedValue(null);

    const response = await listConversions();

    expect(response.status).toBe(401);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("lists only the current user's records newest first", async () => {
    mocks.findMany.mockResolvedValue([{ id: "conversion-1", title: "讲义" }]);

    const response = await listConversions();

    expect(response.status).toBe(200);
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        originalName: true,
        status: true,
        pageCount: true,
        createdAt: true,
      },
    });
    await expect(response.json()).resolves.toEqual({
      conversions: [{ id: "conversion-1", title: "讲义" }],
    });
  });

  it("scopes detail lookup to the current user", async () => {
    mocks.findFirst.mockResolvedValue({
      id: "conversion-1",
      userId: "user-1",
      markdownContent: "# 讲义",
      assets: [],
    });

    const response = await getConversion(new Request("http://localhost"), {
      params: Promise.resolve({ id: "conversion-1" }),
    });

    expect(response.status).toBe(200);
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { id: "conversion-1", userId: "user-1" },
      include: {
        assets: { select: { id: true, relativePath: true } },
      },
    });
  });

  it("returns 404 when deleting a record outside the current user's scope", async () => {
    mocks.findFirst.mockResolvedValue(null);

    const response = await deleteConversion(new Request("http://localhost"), {
      params: Promise.resolve({ id: "conversion-2" }),
    });

    expect(response.status).toBe(404);
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { id: "conversion-2", userId: "user-1" },
      select: {
        id: true,
        exportStorageProvider: true,
        exportStoragePath: true,
        assets: {
          select: { storageProvider: true, storagePath: true },
        },
      },
    });
  });
});
