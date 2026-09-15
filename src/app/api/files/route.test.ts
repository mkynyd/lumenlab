// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  queryFiles: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/logger", () => ({
  logger: { error: mocks.loggerError, warn: vi.fn(), info: vi.fn() },
}));
// 只替换查询函数，参数守卫仍走真实实现
vi.mock("@/lib/files/file-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/files/file-query")>();
  return { ...actual, queryFiles: mocks.queryFiles };
});

import { FileQueryInputError } from "@/lib/files/file-query";
import { GET } from "./route";

function request(query = "") {
  return new Request(`http://localhost/api/files${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
  mocks.queryFiles.mockResolvedValue({ files: [], nextCursor: null });
});

describe("GET /api/files", () => {
  it("未登录返回 401 且不查询", async () => {
    mocks.auth.mockResolvedValue(null);

    const response = await GET(request("?q=讲义"));

    expect(response.status).toBe(401);
    expect(mocks.queryFiles).not.toHaveBeenCalled();
  });

  it("把查询参数传给查询层，并限定当前用户", async () => {
    await GET(
      request(
        "?q=%E8%AE%B2%E4%B9%89&projectId=project-1&category=%E5%AE%9E%E9%AA%8C&mimeGroup=document&status=warning&sort=relevance&limit=10&cursor=abc"
      )
    );

    expect(mocks.queryFiles).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        q: "讲义",
        projectId: "project-1",
        category: "实验",
        mimeGroup: "document",
        status: "warning",
        sort: "relevance",
        cursor: "abc",
        limit: 10,
      })
    );
  });

  it("拒绝非法的筛选与排序值", async () => {
    const cases = [
      "?mimeGroup=archive",
      "?status=done",
      "?sort=createdAt",
    ];
    for (const query of cases) {
      const response = await GET(request(query));
      expect(response.status).toBe(400);
    }
    expect(mocks.queryFiles).not.toHaveBeenCalled();
  });

  it("limit 走统一规范化，越界请求不会透传", async () => {
    await GET(request("?limit=9999"));

    expect(mocks.queryFiles).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 100 })
    );
  });

  it("把查询层的输入错误映射成 400", async () => {
    mocks.queryFiles.mockRejectedValue(new FileQueryInputError("无效的文件游标"));

    const response = await GET(request("?cursor=broken"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "无效的文件游标" });
  });

  it("查询层异常记为 500 并记日志", async () => {
    mocks.queryFiles.mockRejectedValue(new Error("connection reset"));

    const response = await GET(request(""));

    expect(response.status).toBe(500);
    expect(mocks.loggerError).toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ error: "查询文件失败" });
  });

  it("返回文件列表与下一页游标", async () => {
    mocks.queryFiles.mockResolvedValue({
      files: [{ id: "file-1", originalName: "讲义.md" }],
      nextCursor: "next-page",
    });

    const response = await GET(request(""));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      files: [{ id: "file-1", originalName: "讲义.md" }],
      nextCursor: "next-page",
    });
  });
});
