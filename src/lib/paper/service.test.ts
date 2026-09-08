import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  paperDocument: { findFirst: vi.fn() },
  paperImport: { findFirst: vi.fn() },
  templateBinding: { findUnique: vi.fn() },
  reference: { findMany: vi.fn() },
  paperCompilation: { upsert: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/storage/object-storage", () => ({ uploadObjectBuffer: vi.fn() }));

import { createDocumentVersion, queuePaperCompilation } from "./service";

describe("paper compilation state guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.paperDocument.findFirst.mockResolvedValue({
      id: "document-1",
      currentVersion: { id: "version-1", version: 1, content: { title: "Test", blocks: [] } },
      workspace: { id: "workspace-1", projectId: null },
    });
    prisma.templateBinding.findUnique.mockResolvedValue(null);
    prisma.reference.findMany.mockResolvedValue([]);
    prisma.paperCompilation.upsert.mockResolvedValue({ id: "compilation-1", status: "queued" });
  });

  it("rejects compilation while an import awaits structure confirmation", async () => {
    prisma.paperImport.findFirst.mockResolvedValue({ id: "import-1" });

    await expect(queuePaperCompilation("user-1", "document-1")).rejects.toMatchObject({
      code: "INVALID_STATE",
      message: "请先确认导入结构后再修改或编译",
    });
  });

  it("rejects document version writes while an import awaits structure confirmation", async () => {
    prisma.paperImport.findFirst.mockResolvedValue({ id: "import-1" });

    await expect(createDocumentVersion({ userId: "user-1", documentId: "document-1", content: { title: "Test", blocks: [] } })).rejects.toMatchObject({
      code: "INVALID_STATE",
      message: "请先确认导入结构后再修改或编译",
    });
  });

  it("queues compilation after confirmation", async () => {
    prisma.paperImport.findFirst.mockResolvedValue(null);

    await expect(queuePaperCompilation("user-1", "document-1")).resolves.toMatchObject({ compilation: { id: "compilation-1", status: "queued" } });
    expect(prisma.paperImport.findFirst).toHaveBeenCalledWith({
      where: { paperDocumentId: "document-1", userId: "user-1", status: "awaiting_confirmation" },
      select: { id: true },
    });
    expect(prisma.paperCompilation.upsert).toHaveBeenCalledOnce();
  });
});
