// @vitest-environment node

import AdmZip from "adm-zip";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  fileFindMany: vi.fn(),
  readStoredObject: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({
  prisma: { fileAsset: { findMany: mocks.fileFindMany } },
}));
vi.mock("@/lib/storage/object-storage", () => ({
  readStoredObject: mocks.readStoredObject,
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: mocks.loggerError, warn: vi.fn(), info: vi.fn() },
}));

import { POST } from "./route";

function request(body: unknown) {
  return new Request("http://localhost/api/files/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function fileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "file-1",
    originalName: "数据结构讲义.pdf",
    textContent: "# 线性表\n\n![结构图](pics/table-1.png)\n",
    resources: [
      {
        relativePath: "pics/table-1.png",
        storageProvider: "local",
        storagePath: "uploads/user-1/resource-1.png",
      },
    ],
    ...overrides,
  };
}

async function readZip(response: Response) {
  const zip = new AdmZip(Buffer.from(await response.arrayBuffer()));
  return {
    names: zip.getEntries().map((entry) => entry.entryName),
    text: (name: string) => zip.getEntry(name)?.getData().toString("utf-8") ?? null,
    bytes: (name: string) => zip.getEntry(name)?.getData() ?? null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
  mocks.fileFindMany.mockResolvedValue([fileRow()]);
  mocks.readStoredObject.mockResolvedValue(Buffer.from([1, 2, 3]));
});

describe("POST /api/files/export", () => {
  it("未登录返回 401", async () => {
    mocks.auth.mockResolvedValue(null);

    const response = await POST(request({ fileIds: ["file-1"] }));

    expect(response.status).toBe(401);
    expect(mocks.fileFindMany).not.toHaveBeenCalled();
  });

  it("拒绝空选择与超量选择", async () => {
    expect((await POST(request({ fileIds: [] }))).status).toBe(400);
    expect(
      (
        await POST(
          request({ fileIds: Array.from({ length: 51 }, (_, i) => `f${i}`) })
        )
      ).status
    ).toBe(400);
    expect(mocks.fileFindMany).not.toHaveBeenCalled();
  });

  it("查询强制限定当前用户", async () => {
    await POST(request({ fileIds: ["file-1"] }));

    expect(mocks.fileFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["file-1"] }, userId: "user-1" },
      })
    );
  });

  it("没有任何可导出文件时返回 404", async () => {
    mocks.fileFindMany.mockResolvedValue([]);

    const response = await POST(request({ fileIds: ["file-1"] }));

    expect(response.status).toBe(404);
  });

  it("导出 Markdown 正文与相对路径下的图片", async () => {
    const response = await POST(request({ fileIds: ["file-1"] }));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/zip");

    const zip = await readZip(response);
    expect(zip.names).toContain("数据结构讲义/数据结构讲义.md");
    // 图片路径与正文里的相对引用保持一致，Markdown 链接可直接打开
    expect(zip.names).toContain("数据结构讲义/pics/table-1.png");
    expect(zip.text("数据结构讲义/数据结构讲义.md")).toContain("pics/table-1.png");
    expect(zip.names).toContain("导出说明.txt");
  });

  it("说明文件写清导出范围与跳过项", async () => {
    mocks.fileFindMany.mockResolvedValue([
      fileRow(),
      fileRow({ id: "file-2", originalName: "扫描件.pdf", textContent: null }),
    ]);

    const zip = await readZip(await POST(request({ fileIds: ["file-1", "file-2"] })));
    const readme = zip.text("导出说明.txt") ?? "";

    expect(readme).toContain("基础解析");
    expect(readme).toContain("不含 AI 整理内容");
    expect(readme).toContain("跳过 1 份");
    expect(readme).toContain("扫描件.pdf");
    expect(zip.names.some((name) => name.startsWith("扫描件/"))).toBe(false);
  });

  it("所选资料都没有解析正文时明确失败", async () => {
    mocks.fileFindMany.mockResolvedValue([
      fileRow({ textContent: null, resources: [] }),
    ]);

    const response = await POST(request({ fileIds: ["file-1"] }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "所选资料都还没有解析正文，无法导出",
    });
  });

  it("重名资料不会互相覆盖", async () => {
    mocks.fileFindMany.mockResolvedValue([
      fileRow({ id: "file-1", originalName: "讲义.pdf", resources: [] }),
      fileRow({ id: "file-2", originalName: "讲义.docx", resources: [] }),
    ]);

    const zip = await readZip(await POST(request({ fileIds: ["file-1", "file-2"] })));

    expect(zip.names).toContain("讲义/讲义.md");
    expect(zip.names).toContain("讲义 (2)/讲义 (2).md");
  });

  it("图片对象缺失时仍导出正文", async () => {
    mocks.readStoredObject.mockRejectedValue(new Error("ENOENT"));

    const response = await POST(request({ fileIds: ["file-1"] }));

    expect(response.status).toBe(200);
    const zip = await readZip(response);
    expect(zip.names).toContain("数据结构讲义/数据结构讲义.md");
    expect(zip.names).not.toContain("数据结构讲义/pics/table-1.png");
  });
});
