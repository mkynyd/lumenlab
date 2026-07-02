import { describe, expect, it, vi } from "vitest";
import { extractSearchKeywords, ragSearch } from "./project-rag";
import { prisma } from "@/lib/db";

vi.mock("@/lib/db", () => ({
  prisma: {
    fileAsset: {
      findMany: vi.fn(),
    },
  },
}));

describe("project RAG keyword search", () => {
  it("extracts searchable Chinese keywords from natural prompts", () => {
    expect(extractSearchKeywords("请提取网络安全核心知识点")).toContain("网络");
    expect(extractSearchKeywords("请提取网络安全核心知识点")).toContain("安全");
  });

  it("matches Chinese project file content", async () => {
    vi.mocked(prisma.fileAsset.findMany).mockResolvedValueOnce([
      {
        id: "file-1",
        originalName: "网络协议安全上.pptx",
        textContent: "网络安全协议包括 TLS 握手、证书校验与中间人攻击防护。",
      },
    ] as Awaited<ReturnType<typeof prisma.fileAsset.findMany>>);

    const result = await ragSearch("user-1", "project-1", "提取网络安全知识点");

    expect(result).toMatchObject({
      totalMatched: 1,
      hits: [
        {
          file: "网络协议安全上.pptx",
          fileId: "file-1",
        },
      ],
    });
  });
});
