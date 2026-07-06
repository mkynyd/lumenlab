import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseFileContent } from "../parse-job";
import * as storage from "@/lib/storage/object-storage";
import * as providerAccess from "@/lib/data/provider-access";
import * as minimax from "@/lib/vision/minimax";
import * as mineru from "@/lib/parse/mineru";
import { prisma } from "@/lib/db";

vi.mock("@/lib/storage/object-storage");
vi.mock("@/lib/data/provider-access");
vi.mock("@/lib/vision/minimax");
vi.mock("@/lib/parse/mineru");
vi.mock("@/lib/db", () => ({
  prisma: {
    fileAsset: {
      update: vi.fn(),
    },
  },
}));

describe("parseFileContent", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(storage.readStoredObject).mockResolvedValue(Buffer.from("content"));
    vi.mocked(providerAccess.getProviderApiKey).mockResolvedValue("key");
    vi.mocked(prisma.fileAsset.update).mockResolvedValue({} as never);
  });

  it("routes text files to text-local parser", async () => {
    const result = await parseFileContent({
      userId: "u1",
      file: {
        id: "f1",
        originalName: "notes.md",
        mimeType: "text/markdown",
        storageProvider: "local",
        storagePath: "files/f1.md",
        processingMetadata: {},
      },
    });
    expect(result.metadata.parser).toBe("text-local");
    expect(result.metadata.requiresVisionModel).toBe(false);
  });

  it("routes pdf to minimax-m3-pdf parser", async () => {
    vi.mocked(minimax.parseDocumentWithMiniMax).mockResolvedValue("# PDF\n\nText");
    const result = await parseFileContent({
      userId: "u1",
      file: {
        id: "f1",
        originalName: "doc.pdf",
        mimeType: "application/pdf",
        storageProvider: "local",
        storagePath: "files/f1.pdf",
        processingMetadata: {},
      },
    });
    expect(result.metadata.parser).toBe("minimax-m3-pdf");
    expect(result.metadata.requiresVisionModel).toBe(true);
  });

  it("routes office files to mineru-office parser", async () => {
    vi.mocked(mineru.parseFileWithMinerU).mockResolvedValue({
      content: "# Slide",
      assets: [],
      metadata: {
        parser: "mineru-pipeline" as const,
        taskId: "task-1",
        parsedAt: new Date().toISOString(),
      },
    });
    const result = await parseFileContent({
      userId: "u1",
      file: {
        id: "f1",
        originalName: "slides.pptx",
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        storageProvider: "local",
        storagePath: "files/f1.pptx",
        processingMetadata: {},
      },
    });
    expect(result.metadata.parser).toBe("mineru-office");
  });
});
