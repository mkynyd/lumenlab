// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  fileFindFirst: vi.fn(),
  fileDelete: vi.fn(),
  fileUpdate: vi.fn(),
  deleteStoredObject: vi.fn(),
  deleteChunksByFileAsset: vi.fn(),
  createDocumentChunks: vi.fn(),
  refreshProjectIndex: vi.fn(),
  recordFileContentChange: vi.fn(),
  recordFileDeletion: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({
  prisma: {
    fileAsset: {
      findFirst: mocks.fileFindFirst,
      delete: mocks.fileDelete,
      update: mocks.fileUpdate,
    },
  },
}));
vi.mock("@/lib/storage/object-storage", () => ({
  deleteStoredObject: mocks.deleteStoredObject,
}));
vi.mock("@/lib/rag/vector-store", () => ({
  createDocumentChunks: mocks.createDocumentChunks,
  deleteChunksByFileAsset: mocks.deleteChunksByFileAsset,
}));
vi.mock("@/lib/rag/project-index", () => ({
  refreshProjectIndex: mocks.refreshProjectIndex,
  fallbackIndexMetadata: ({ content }: { content: string | null }) => ({
    summary: content || "暂无可检索正文",
    keywords: [],
  }),
}));
vi.mock("@/lib/learning/services", () => ({
  recordFileContentChange: mocks.recordFileContentChange,
  recordFileDeletion: mocks.recordFileDeletion,
}));

import { DELETE, GET, PATCH } from "@/app/api/files/[id]/route";

const context = { params: Promise.resolve({ id: "file-1" }) };

describe("project file route resources", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.fileFindFirst.mockResolvedValue({
      id: "file-1",
      userId: "user-1",
      projectId: "project-1",
      filename: "lecture.md",
      originalName: "lecture.md",
      mimeType: "text/markdown",
      size: 1024,
      status: "parsed",
      textContent: "![电路](pics/circuit.png)",
      enhancedContent: null,
      enhancementStatus: "none",
      contentFingerprint: "sha256:v1:private",
      storageProvider: "local",
      storagePath: "files/lecture.md",
      resources: [
        {
          id: "resource-1",
          relativePath: "pics/circuit.png",
          storageProvider: "local",
          storagePath: "resources/circuit.png",
        },
      ],
    });
    mocks.deleteStoredObject.mockResolvedValue(undefined);
    mocks.deleteChunksByFileAsset.mockResolvedValue(undefined);
    mocks.refreshProjectIndex.mockResolvedValue(undefined);
    mocks.fileDelete.mockResolvedValue({ id: "file-1" });
    mocks.fileUpdate.mockResolvedValue({ id: "file-1" });
    mocks.createDocumentChunks.mockResolvedValue(1);
    mocks.recordFileContentChange.mockResolvedValue({
      changed: true,
      knowledgePoints: [],
      practiceItems: [],
    });
    mocks.recordFileDeletion.mockResolvedValue({
      changed: true,
      knowledgePoints: [],
      practiceItems: [],
    });
  });

  it("returns public resource IDs and paths without object storage keys", async () => {
    const response = await GET(new Request("http://localhost"), context);
    const body = await response.json();

    expect(body.file.resources).toEqual([
      { id: "resource-1", relativePath: "pics/circuit.png" },
    ]);
    expect(JSON.stringify(body)).not.toContain("resources/circuit.png");
    expect(JSON.stringify(body)).not.toContain("files/lecture.md");
    expect(JSON.stringify(body)).not.toContain("contentFingerprint");
  });

  it("deletes project image resources with the main file object", async () => {
    const response = await DELETE(new Request("http://localhost"), context);

    expect(response.status).toBe(200);
    expect(mocks.deleteStoredObject).toHaveBeenCalledWith({
      provider: "local",
      key: "files/lecture.md",
    });
    expect(mocks.deleteStoredObject).toHaveBeenCalledWith({
      provider: "local",
      key: "resources/circuit.png",
    });
    expect(mocks.recordFileDeletion).toHaveBeenCalledWith({
      userId: "user-1",
      fileAssetId: "file-1",
      previousFingerprint: "sha256:v1:private",
    });
    expect(
      mocks.fileDelete.mock.invocationCallOrder[0]
    ).toBeLessThan(mocks.recordFileDeletion.mock.invocationCallOrder[0]);
  });

  it("versions manually corrected OCR content", async () => {
    const response = await PATCH(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ textContent: "修订后的 OCR 正文" }),
      }),
      context
    );

    expect(response.status).toBe(200);
    expect(mocks.fileUpdate).toHaveBeenCalledWith({
      where: { id: "file-1" },
      data: expect.objectContaining({
        textContent: "修订后的 OCR 正文",
        contentFingerprint: expect.stringMatching(/^sha256:v1:[a-f0-9]{64}$/),
        processingMetadata: expect.objectContaining({
          summary: "修订后的 OCR 正文",
        }),
      }),
    });
    expect(mocks.recordFileContentChange).toHaveBeenCalledWith({
      userId: "user-1",
      fileAssetId: "file-1",
      previousFingerprint: "sha256:v1:private",
      currentFingerprint: expect.stringMatching(/^sha256:v1:[a-f0-9]{64}$/),
    });
  });
});
