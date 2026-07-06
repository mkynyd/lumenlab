import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  userFindUnique: vi.fn(),
  userUpdate: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: mocks.auth,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: mocks.userFindUnique,
      update: mocks.userUpdate,
    },
  },
}));

import { GET, PATCH } from "./route";

function makePatchRequest(body: unknown) {
  return new Request("http://localhost/api/user/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/user/profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.userFindUnique.mockResolvedValue({
      email: "student@example.com",
      name: "YJH",
      avatarPreset: "code",
      avatarObjectKey: "users/user-1/profile/avatar/avatar.png",
      avatarUpdatedAt: new Date("2026-07-03T06:30:00.000Z"),
    });
    mocks.userUpdate.mockResolvedValue({
      email: "student@example.com",
      name: "殷浚航",
      avatarPreset: "study",
      avatarObjectKey: null,
      avatarUpdatedAt: null,
    });
  });

  it("returns the current profile for the authenticated user", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      email: "student@example.com",
      name: "YJH",
      avatarPreset: "code",
      avatarUrl: "/api/user/profile/avatar?v=1783060200000",
    });
    expect(mocks.userFindUnique).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: {
        email: true,
        name: true,
        avatarPreset: true,
        avatarObjectKey: true,
        avatarUpdatedAt: true,
      },
    });
  });

  it("updates name and avatar preset", async () => {
    const response = await PATCH(
      makePatchRequest({ name: "  殷浚航  ", avatarPreset: "study" })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      email: "student@example.com",
      name: "殷浚航",
      avatarPreset: "study",
      avatarUrl: null,
    });
    expect(mocks.userUpdate).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { name: "殷浚航", avatarPreset: "study" },
      select: {
        email: true,
        name: true,
        avatarPreset: true,
        avatarObjectKey: true,
        avatarUpdatedAt: true,
      },
    });
  });

  it("updates only the name when avatar preset is omitted", async () => {
    await PATCH(makePatchRequest({ name: "  殷浚航  " }));

    expect(mocks.userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { name: "殷浚航" },
      })
    );
  });

  it("clears blank names", async () => {
    await PATCH(makePatchRequest({ name: " " }));

    expect(mocks.userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { name: null },
      })
    );
  });

  it("rejects invalid avatar presets", async () => {
    const response = await PATCH(
      makePatchRequest({ name: "YJH", avatarPreset: "custom" })
    );

    expect(response.status).toBe(400);
    expect(mocks.userUpdate).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    mocks.auth.mockResolvedValue(null);

    expect((await GET()).status).toBe(401);
    expect((await PATCH(makePatchRequest({ name: "YJH" }))).status).toBe(401);
  });
});
