import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { readProjectFile } from "./read";

vi.mock("@/lib/db", () => ({
  prisma: {
    fileAsset: {
      findFirst: vi.fn(),
    },
  },
}));

describe("readProjectFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns OCR text instead of stale enhanced content", async () => {
    vi.mocked(prisma.fileAsset.findFirst).mockResolvedValue({
      id: "file-1",
      originalName: "修订讲义.md",
      mimeType: "text/markdown",
      status: "parsed",
      textContent: "当前 OCR 正文",
      enhancedContent: "已经过期的增强正文",
      enhancementStatus: "stale",
    } as never);

    const result = await readProjectFile("user-1", "project-1", "file-1");

    expect(result.text).toBe("当前 OCR 正文");
    expect(result.text).not.toBe("已经过期的增强正文");
  });

  it("pages through long files via offset and nextOffset", async () => {
    const longText = "0123456789".repeat(1200); // 12000 字符
    vi.mocked(prisma.fileAsset.findFirst).mockResolvedValue({
      id: "file-1",
      originalName: "长文档.pdf",
      mimeType: "application/pdf",
      status: "parsed",
      textContent: longText,
      enhancedContent: null,
      enhancementStatus: "none",
    } as never);

    const first = await readProjectFile(
      "user-1",
      "project-1",
      "file-1",
      8000
    );
    expect(first.text).toHaveLength(8000);
    expect(first.truncated).toBe(true);
    expect(first.nextOffset).toBe(8000);

    const second = await readProjectFile(
      "user-1",
      "project-1",
      "file-1",
      8000,
      Number(first.nextOffset)
    );
    expect(second.text).toHaveLength(4000);
    expect(second.truncated).toBe(false);
    expect(second.nextOffset).toBeNull();
  });
});
