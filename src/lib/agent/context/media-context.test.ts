// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveProjectMediaContext,
  MAX_SELECTED_PROJECT_IMAGES,
} from "./media-context";
import { prisma } from "@/lib/db";
import * as storage from "@/lib/storage/object-storage";

vi.mock("@/lib/db", () => ({
  prisma: {
    fileAsset: {
      findMany: vi.fn(),
    },
  },
}));
vi.mock("@/lib/storage/object-storage", () => ({
  readStoredObject: vi.fn(),
}));

function asset(id: string, name: string, size = 1024) {
  return {
    id,
    originalName: name,
    size,
    mimeType: "image/png",
    storageProvider: "local",
    storagePath: `files/${id}.png`,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(storage.readStoredObject).mockResolvedValue(
    Buffer.alloc(1024, "png")
  );
});

describe("resolveProjectMediaContext", () => {
  it("无条件携带选中的项目图片（归属校验条件随查询下发）", async () => {
    vi.mocked(prisma.fileAsset.findMany).mockResolvedValue([
      asset("f1", "函数图像.png"),
      asset("f2", "实验照片.png"),
    ] as never);

    const result = await resolveProjectMediaContext({
      userId: "u1",
      projectId: "p1",
      selectedFiles: [
        { id: "f1", originalName: "函数图像.png", mimeType: "image/png" },
        { id: "f2", originalName: "实验照片.png", mimeType: "image/png" },
      ],
      prompt: "解释这两张图",
      includeProjectImages: false,
      wholeCorpus: false,
    });

    expect(result.attachments.map((a) => a.name)).toEqual([
      "函数图像.png",
      "实验照片.png",
    ]);
    expect(result.coverageNote).toContain("选中的 2 张");
    expect(prisma.fileAsset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "u1",
          projectId: "p1",
          mimeType: { startsWith: "image/" },
        }),
      })
    );
  });

  it("选中图片超出上限时只带前 N 张并说明截断", async () => {
    vi.mocked(prisma.fileAsset.findMany).mockImplementation((args) => {
      const ids = (args?.where as { id: { in: string[] } }).id.in;
      return Promise.resolve(ids.map((id) => asset(id, `${id}.png`))) as never;
    });
    const selected = Array.from({ length: MAX_SELECTED_PROJECT_IMAGES + 2 }, (_, i) => ({
      id: `f${i}`,
      originalName: `f${i}.png`,
      mimeType: "image/png",
    }));

    const result = await resolveProjectMediaContext({
      userId: "u1",
      projectId: "p1",
      selectedFiles: selected,
      prompt: "看图",
      includeProjectImages: false,
      wholeCorpus: false,
    });

    expect(result.attachments).toHaveLength(MAX_SELECTED_PROJECT_IMAGES);
    expect(result.coverageNote).toContain("未随本次请求携带");
  });

  it("未选文件且无需项目资料时不携带任何图片", async () => {
    const result = await resolveProjectMediaContext({
      userId: "u1",
      projectId: "p1",
      selectedFiles: [],
      prompt: "你好",
      includeProjectImages: false,
      wholeCorpus: false,
    });
    expect(result.attachments).toHaveLength(0);
    expect(prisma.fileAsset.findMany).not.toHaveBeenCalled();
  });

  it("自动候选按文件名/描述匹配，超限不静默全带", async () => {
    vi.mocked(prisma.fileAsset.findMany).mockResolvedValue([
      asset("f1", "细胞结构图.png"),
      asset("f2", "实验流程图.png"),
      asset("f3", "成绩统计.png"),
      asset("f4", "课程大纲.png"),
      asset("f5", "随机笔记.png"),
    ] as never);

    const result = await resolveProjectMediaContext({
      userId: "u1",
      projectId: "p1",
      selectedFiles: [],
      prompt: "请讲解细胞结构图",
      includeProjectImages: true,
      wholeCorpus: false,
    });

    expect(result.attachments.map((a) => a.name)).toEqual(["细胞结构图.png"]);
    expect(result.coverageNote).toContain("自动携带");
  });

  it("整库快捷任务携带图片并显式说明覆盖范围", async () => {
    vi.mocked(prisma.fileAsset.findMany).mockResolvedValue([
      asset("f1", "a.png"),
      asset("f2", "b.png"),
      asset("f3", "c.png"),
    ] as never);

    const result = await resolveProjectMediaContext({
      userId: "u1",
      projectId: "p1",
      selectedFiles: [],
      prompt: "总结全部资料",
      includeProjectImages: false,
      wholeCorpus: true,
    });

    expect(result.attachments).toHaveLength(3);
    expect(result.coverageNote).toContain("自动携带了 3 张项目图片");
  });

  it("单张读取失败不阻塞其余图片，并计入覆盖说明", async () => {
    vi.mocked(prisma.fileAsset.findMany).mockResolvedValue([
      asset("f1", "bad.png"),
      asset("f2", "good.png"),
    ] as never);
    vi.mocked(storage.readStoredObject).mockImplementation(async (input) => {
      if ((input as { key: string }).key.includes("f1")) {
        throw new Error("missing object");
      }
      return Buffer.alloc(1024, "png");
    });

    const result = await resolveProjectMediaContext({
      userId: "u1",
      projectId: "p1",
      selectedFiles: [
        { id: "f1", originalName: "bad.png", mimeType: "image/png" },
        { id: "f2", originalName: "good.png", mimeType: "image/png" },
      ],
      prompt: "看图",
      includeProjectImages: false,
      wholeCorpus: false,
    });

    expect(result.attachments.map((a) => a.name)).toEqual(["good.png"]);
    expect(result.coverageNote).toContain("bad.png");
  });
});
