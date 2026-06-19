import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  fileFindFirst: vi.fn(),
  createSignedDownloadUrl: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: mocks.auth,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    fileAsset: {
      findFirst: mocks.fileFindFirst,
    },
  },
}));

vi.mock("@/lib/storage/object-storage", () => ({
  createSignedDownloadUrl: mocks.createSignedDownloadUrl,
}));

import { GET } from "@/app/api/files/[id]/download/route";

describe("GET /api/files/[id]/download", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.fileFindFirst.mockResolvedValue({
      id: "file-1",
      userId: "user-1",
      originalName: "lecture.pdf",
      mimeType: "application/pdf",
      storageProvider: "qiniu",
      storagePath: "users/user-1/projects/project-1/files/file-1/file.pdf",
    });
    mocks.createSignedDownloadUrl.mockReturnValue("https://coursecdn.mkynstudio.top/signed");
  });

  it("checks file ownership before returning a short-lived signed URL", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/files/file-1/download"),
      { params: Promise.resolve({ id: "file-1" }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.fileFindFirst).toHaveBeenCalledWith({
      where: { id: "file-1", userId: "user-1" },
    });
    expect(mocks.createSignedDownloadUrl).toHaveBeenCalledWith({
      provider: "qiniu",
      key: "users/user-1/projects/project-1/files/file-1/file.pdf",
      filename: "lecture.pdf",
      expiresInSeconds: 600,
    });
    await expect(response.json()).resolves.toEqual({
      url: "https://coursecdn.mkynstudio.top/signed",
    });
  });
});
