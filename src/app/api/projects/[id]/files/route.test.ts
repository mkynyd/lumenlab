import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  projectFindFirst: vi.fn(),
  fileAssetCreate: vi.fn(),
  startFileParseBatch: vi.fn(),
  uploadFileBuffer: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: mocks.auth,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    project: {
      findFirst: mocks.projectFindFirst,
    },
    fileAsset: {
      create: mocks.fileAssetCreate,
    },
  },
}));

vi.mock("@/lib/files/parse-job", () => ({
  startFileParseBatch: mocks.startFileParseBatch,
}));

vi.mock("@/lib/storage/object-storage", () => ({
  uploadFileBuffer: mocks.uploadFileBuffer,
}));

import { POST } from "@/app/api/projects/[id]/files/route";

describe("POST /api/projects/[id]/files", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.projectFindFirst.mockResolvedValue({ id: "project-1", userId: "user-1" });
    mocks.uploadFileBuffer.mockResolvedValue({
      provider: "qiniu",
      key: "users/user-1/projects/project-1/files/file-1/file.pdf",
    });
    mocks.fileAssetCreate.mockResolvedValue({
      id: "file-1",
      filename: "file.pdf",
      originalName: "lecture.pdf",
      mimeType: "application/pdf",
      size: 7,
      storageProvider: "qiniu",
      storagePath: "users/user-1/projects/project-1/files/file-1/file.pdf",
      status: "parsing",
      enhancementStatus: "none",
      processingMetadata: null,
      category: null,
      categoryConfidence: null,
      createdAt: new Date("2026-06-19T00:00:00.000Z"),
    });
  });

  it("stores uploaded files through object storage and records the provider", async () => {
    const body = new FormData();
    body.append(
      "files",
      new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7])], "lecture.pdf", {
        type: "application/pdf",
      }),
      "lecture.pdf"
    );

    const response = await POST(
      { formData: async () => body } as unknown as Request,
      { params: Promise.resolve({ id: "project-1" }) }
    );

    expect(response.status).toBe(201);
    expect(mocks.uploadFileBuffer).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        projectId: "project-1",
        originalName: "lecture.pdf",
        mimeType: "application/pdf",
        buffer: expect.any(Buffer),
      })
    );
    expect(mocks.fileAssetCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        storageProvider: "qiniu",
        storagePath: "users/user-1/projects/project-1/files/file-1/file.pdf",
      }),
    });
    expect(mocks.startFileParseBatch).toHaveBeenCalledWith({
      userId: "user-1",
      fileIds: ["file-1"],
    });
  });
});
