import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  userFindUnique: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({
  prisma: { user: { findUnique: mocks.userFindUnique } },
}));

import { getAdminUser, isAdminEmail } from "@/lib/admin";

describe("isAdminEmail", () => {
  beforeEach(() => {
    vi.stubEnv("ADMIN_EMAILS", "Admin@Example.com, second@example.com");
  });

  it("matches case-insensitively and trims spaces", () => {
    expect(isAdminEmail("admin@example.com")).toBe(true);
    expect(isAdminEmail("second@example.com")).toBe(true);
  });

  it("rejects non-admin and empty input", () => {
    expect(isAdminEmail("student@example.com")).toBe(false);
    expect(isAdminEmail(null)).toBe(false);
    expect(isAdminEmail(undefined)).toBe(false);
  });

  it("rejects everything when ADMIN_EMAILS is unset", () => {
    vi.stubEnv("ADMIN_EMAILS", "");
    expect(isAdminEmail("admin@example.com")).toBe(false);
  });
});

describe("getAdminUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ADMIN_EMAILS", "admin@example.com");
  });

  it("returns null when not logged in", async () => {
    mocks.auth.mockResolvedValue(null);
    expect(await getAdminUser()).toBeNull();
  });

  it("returns null for non-admin user", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "u1" } });
    mocks.userFindUnique.mockResolvedValue({ id: "u1", email: "student@example.com" });
    expect(await getAdminUser()).toBeNull();
  });

  it("returns the user for admin email", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "u1" } });
    mocks.userFindUnique.mockResolvedValue({ id: "u1", email: "admin@example.com" });
    expect(await getAdminUser()).toEqual({ id: "u1", email: "admin@example.com" });
  });
});
