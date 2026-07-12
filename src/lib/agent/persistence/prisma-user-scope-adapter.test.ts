import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: mocks.findUnique },
  },
}));

import { PrismaUserScopeAdapter } from "./prisma-user-scope-adapter";

describe("PrismaUserScopeAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the exact persisted scopes", async () => {
    mocks.findUnique.mockResolvedValue({
      scopes: ["project.read", "artifact.write"],
    });

    const adapter = new PrismaUserScopeAdapter();

    await expect(adapter.load("user-1")).resolves.toEqual([
      "project.read",
      "artifact.write",
    ]);
  });

  it.each([
    ["an explicit empty scope set", { scopes: [] }],
    ["a malformed legacy record", {}],
    ["a malformed scope array", { scopes: ["project.read", null] }],
    ["a missing user", null],
  ])("fails closed for %s", async (_label, storedUser) => {
    mocks.findUnique.mockResolvedValue(storedUser);

    const adapter = new PrismaUserScopeAdapter();

    await expect(adapter.load("user-1")).resolves.toEqual([]);
  });
});
