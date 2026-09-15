// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  fileFindFirst: vi.fn(),
  readStoredObject: vi.fn(),
  readStoredObjectRange: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({
  prisma: { fileAsset: { findFirst: mocks.fileFindFirst } },
}));
vi.mock("@/lib/storage/object-storage", () => ({
  readStoredObject: mocks.readStoredObject,
  readStoredObjectRange: mocks.readStoredObjectRange,
}));

import { GET } from "./route";

const FILE = {
  originalName: "数据结构讲义.pdf",
  mimeType: "application/pdf",
  storageProvider: "local",
  storagePath: "uploads/user-1/file-1.pdf",
};

function call(query = "", headers: Record<string, string> = {}) {
  const request = new NextRequest(`http://localhost/api/files/file-1/content${query}`, {
    headers,
  });
  return GET(request, { params: Promise.resolve({ id: "file-1" }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
  mocks.fileFindFirst.mockResolvedValue(FILE);
  mocks.readStoredObject.mockResolvedValue(Buffer.from("PDF-BYTES"));
  mocks.readStoredObjectRange.mockResolvedValue({
    data: Buffer.from("0123"),
    totalSize: 100,
    start: 0,
    end: 3,
  });
});

describe("GET /api/files/[id]/content", () => {
  it("未登录返回 401", async () => {
    mocks.auth.mockResolvedValue(null);

    const response = await call();

    expect(response.status).toBe(401);
    expect(mocks.fileFindFirst).not.toHaveBeenCalled();
  });

  it("文件不属于当前用户时按不存在处理", async () => {
    mocks.fileFindFirst.mockResolvedValue(null);

    const response = await call();

    expect(response.status).toBe(404);
    expect(mocks.fileFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "file-1", userId: "user-1" },
      })
    );
  });

  it("默认 inline 预览并保留原始文件名", async () => {
    const response = await call();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    const disposition = response.headers.get("Content-Disposition") ?? "";
    expect(disposition.startsWith("inline; ")).toBe(true);
    expect(disposition).toContain(
      `filename*=UTF-8''${encodeURIComponent("数据结构讲义.pdf")}`
    );
    expect(disposition).toContain('filename="');
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=300");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    await expect(response.arrayBuffer()).resolves.toEqual(
      Buffer.from("PDF-BYTES").buffer
    );
  });

  it("带 Range 时返回 206 与 Content-Range", async () => {
    const response = await call("", { range: "bytes=0-3" });

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 0-3/100");
    expect(response.headers.get("Content-Length")).toBe("4");
    expect(mocks.readStoredObjectRange).toHaveBeenCalledWith({
      provider: "local",
      key: FILE.storagePath,
      start: 0,
      end: 3,
    });
  });

  it("开区间 Range 读取到对象末尾", async () => {
    mocks.readStoredObjectRange.mockResolvedValue({
      data: Buffer.from("tail"),
      totalSize: 100,
      start: 96,
      end: 99,
    });

    const response = await call("", { range: "bytes=96-" });

    expect(response.status).toBe(206);
    expect(mocks.readStoredObjectRange).toHaveBeenCalledWith(
      expect.objectContaining({ start: 96, end: null })
    );
    expect(response.headers.get("Content-Range")).toBe("bytes 96-99/100");
  });

  it("起点越界返回 416 并给出总长度", async () => {
    const response = await call("", { range: "bytes=500-" });

    expect(response.status).toBe(416);
    expect(response.headers.get("Content-Range")).toBe("bytes */100");
  });

  it("无法解析的 Range 退回完整响应而不是报错", async () => {
    const response = await call("", { range: "bytes=-500" });

    expect(response.status).toBe(200);
    expect(mocks.readStoredObject).toHaveBeenCalled();
    expect(mocks.readStoredObjectRange).not.toHaveBeenCalled();
  });

  it("?download=1 切回 attachment 并忽略 Range", async () => {
    const response = await call("?download=1", { range: "bytes=0-3" });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")?.startsWith("attachment; ")).toBe(true);
    expect(mocks.readStoredObjectRange).not.toHaveBeenCalled();
  });

  it("对象缺失返回 410 而不是 500", async () => {
    mocks.readStoredObject.mockRejectedValue(new Error("ENOENT"));

    const response = await call();

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: "原件已不可访问",
      code: "file_unavailable",
    });
  });
});
