import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  userFindUnique: vi.fn(),
  userUpdate: vi.fn(),
  uploadObjectBuffer: vi.fn(),
  readStoredObject: vi.fn(),
  deleteStoredObject: vi.fn(),
  createSignedDownloadUrl: vi.fn(),
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

vi.mock("@/lib/storage/object-storage", () => ({
  createSignedDownloadUrl: mocks.createSignedDownloadUrl,
  uploadObjectBuffer: mocks.uploadObjectBuffer,
  readStoredObject: mocks.readStoredObject,
  deleteStoredObject: mocks.deleteStoredObject,
}));

import { GET, POST } from "./route";

function makeFile(input: { bytes: number[]; name: string; type: string }) {
  const bytes = new Uint8Array(input.bytes);
  return {
    name: input.name,
    type: input.type,
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.buffer,
  } as File;
}

function makeAvatarRequest(file: File) {
  return {
    formData: async () => ({
      get: (key: string) => (key === "avatar" ? file : null),
    }),
  } as unknown as Request;
}

describe("/api/user/profile/avatar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.userFindUnique.mockResolvedValue({
      avatarStorageProvider: "qiniu",
      avatarObjectKey: "users/user-1/profile/avatar/old.png",
      avatarMimeType: "image/png",
    });
    mocks.uploadObjectBuffer.mockResolvedValue({
      provider: "qiniu",
      key: "users/user-1/profile/avatar/new.png",
    });
    mocks.userUpdate.mockResolvedValue({
      email: "student@example.com",
      name: "YJH",
      avatarPreset: "lumen",
      avatarObjectKey: "users/user-1/profile/avatar/new.png",
      avatarUpdatedAt: new Date("2026-07-03T06:45:00.000Z"),
    });
    mocks.readStoredObject.mockResolvedValue(Buffer.from([1, 2, 3]));
    mocks.deleteStoredObject.mockResolvedValue(undefined);
    mocks.createSignedDownloadUrl.mockReturnValue(
      "https://coursecdn.example.com/users/user-1/profile/avatar/old.png-avatar.jpg?e=1783061700&token=ak:signed"
    );
  });

  it("redirects the current Qiniu avatar to the compressed multimedia style", async () => {
    const response = await GET();

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://coursecdn.example.com/users/user-1/profile/avatar/old.png-avatar.jpg?e=1783061700&token=ak:signed"
    );
    expect(mocks.createSignedDownloadUrl).toHaveBeenCalledWith({
      provider: "qiniu",
      key: "users/user-1/profile/avatar/old.png",
      styleName: "avatar.jpg",
      expiresInSeconds: 600,
    });
    expect(mocks.readStoredObject).not.toHaveBeenCalled();
  });

  it("streams local development avatars without a Qiniu style", async () => {
    mocks.userFindUnique.mockResolvedValueOnce({
      avatarStorageProvider: "local",
      avatarObjectKey: "users/user-1/profile/avatar/old.png",
      avatarMimeType: "image/png",
    });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3])
    );
    expect(mocks.readStoredObject).toHaveBeenCalledWith({
      provider: "local",
      key: "users/user-1/profile/avatar/old.png",
    });
  });

  it("uploads an avatar through object storage and updates the user profile", async () => {
    const response = await POST(
      makeAvatarRequest(
        makeFile({ bytes: [1, 2], name: "avatar.png", type: "image/png" })
      )
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      email: "student@example.com",
      name: "YJH",
      avatarPreset: "lumen",
      avatarUrl: "/api/user/profile/avatar?v=1783061100000",
    });
    expect(mocks.uploadObjectBuffer).toHaveBeenCalledWith({
      key: expect.stringMatching(/^users\/user-1\/profile\/avatar\/.+\.png$/),
      mimeType: "image/png",
      buffer: Buffer.from([1, 2]),
    });
    expect(mocks.userUpdate).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: {
        avatarStorageProvider: "qiniu",
        avatarObjectKey: "users/user-1/profile/avatar/new.png",
        avatarMimeType: "image/png",
        avatarUpdatedAt: expect.any(Date),
      },
      select: {
        email: true,
        name: true,
        avatarPreset: true,
        avatarObjectKey: true,
        avatarUpdatedAt: true,
      },
    });
    expect(mocks.deleteStoredObject).toHaveBeenCalledWith({
      provider: "qiniu",
      key: "users/user-1/profile/avatar/old.png",
    });
  });

  it("rejects unsupported avatar formats", async () => {
    const response = await POST(
      makeAvatarRequest(
        makeFile({ bytes: [1], name: "avatar.gif", type: "image/gif" })
      )
    );

    expect(response.status).toBe(400);
    expect(mocks.uploadObjectBuffer).not.toHaveBeenCalled();
  });

  it("rejects avatars larger than 20MB", async () => {
    const response = await POST(
      makeAvatarRequest({
        name: "large.png",
        type: "image/png",
        size: 20 * 1024 * 1024 + 1,
        arrayBuffer: async () => new ArrayBuffer(0),
      } as File)
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: "头像不能超过 20MB",
    });
    expect(mocks.uploadObjectBuffer).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    mocks.auth.mockResolvedValue(null);

    expect((await GET()).status).toBe(401);
    expect(
      (
        await POST(
          makeAvatarRequest(
            makeFile({ bytes: [1], name: "avatar.png", type: "image/png" })
          )
        )
      ).status
    ).toBe(401);
  });
});
