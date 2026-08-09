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

import { GET, PUT } from "./route";

function makePutRequest(body: unknown) {
  return new Request("http://localhost/api/user/persona", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const personaSelect = {
  profileName: true,
  profileProfession: true,
  profileDetails: true,
  profilePrompt: true,
};

describe("/api/user/persona", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.userFindUnique.mockResolvedValue({
      profileName: "殷同学",
      profileProfession: "计算机学院本科生",
      profileDetails: "正在学习操作系统",
      profilePrompt: "你是一名计算机学院本科生……",
    });
    mocks.userUpdate.mockResolvedValue({
      profileName: "殷同学",
      profileProfession: "计算机学院本科生",
      profileDetails: null,
      profilePrompt: null,
    });
  });

  it("returns the saved persona fields and profilePrompt", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      profileName: "殷同学",
      profileProfession: "计算机学院本科生",
      profileDetails: "正在学习操作系统",
      profilePrompt: "你是一名计算机学院本科生……",
    });
    expect(mocks.userFindUnique).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: personaSelect,
    });
  });

  it("persists trimmed persona fields and normalizes blanks to null", async () => {
    const response = await PUT(
      makePutRequest({
        profileName: "  殷同学  ",
        profileProfession: "计算机学院本科生",
        profileDetails: " ",
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.userUpdate).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: {
        profileName: "殷同学",
        profileProfession: "计算机学院本科生",
        profileDetails: null,
      },
      select: personaSelect,
    });
    await expect(response.json()).resolves.toEqual({
      profileName: "殷同学",
      profileProfession: "计算机学院本科生",
      profileDetails: "",
      profilePrompt: "",
    });
  });

  it("rejects over-length fields", async () => {
    const response = await PUT(
      makePutRequest({ profileName: "x".repeat(61) })
    );

    expect(response.status).toBe(400);
    expect(mocks.userUpdate).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON", async () => {
    const response = await PUT(
      new Request("http://localhost/api/user/persona", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      })
    );

    expect(response.status).toBe(400);
    expect(mocks.userUpdate).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    mocks.auth.mockResolvedValue(null);

    expect((await GET()).status).toBe(401);
    expect((await PUT(makePutRequest({ profileName: "YJH" }))).status).toBe(
      401
    );
    expect(mocks.userFindUnique).not.toHaveBeenCalled();
    expect(mocks.userUpdate).not.toHaveBeenCalled();
  });
});
