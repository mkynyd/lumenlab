// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import {
  FileQueryInputError,
  decodeFileQueryCursor,
  encodeFileQueryCursor,
  isFileMimeGroup,
  isFileQuerySort,
  isFileQueryStatus,
  normalizeFileQueryLimit,
  queryFiles,
  type FileQueryClient,
} from "./file-query";

function createClient(rows: Array<Record<string, unknown>> = []) {
  const queries: Prisma.Sql[] = [];
  const client: FileQueryClient = {
    $queryRaw: async <T>(query: Prisma.Sql): Promise<T> => {
      queries.push(query);
      return rows as T;
    },
  };
  return { client, queries };
}

function fileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "file-1",
    originalName: "数据结构讲义.md",
    filename: "stored-1.md",
    mimeType: "text/markdown",
    size: 2048,
    status: "parsed",
    category: "讲义",
    categoryConfidence: 1,
    projectId: "project-1",
    projectName: "408 复习",
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-02T00:00:00.000Z"),
    hasParsedContent: true,
    hasEnhancedContent: false,
    warningCount: 0,
    embeddingStatus: "complete",
    matchKind: null,
    snippet: null,
    rank: 0,
    ...overrides,
  };
}

describe("文件查询参数规范化", () => {
  it("限制 limit 的上限与默认值", () => {
    expect(normalizeFileQueryLimit(null)).toBe(20);
    expect(normalizeFileQueryLimit("abc")).toBe(20);
    expect(normalizeFileQueryLimit("0")).toBe(20);
    expect(normalizeFileQueryLimit("5")).toBe(5);
    expect(normalizeFileQueryLimit("9999")).toBe(100);
  });

  it("识别合法的筛选与排序值", () => {
    expect(isFileMimeGroup("document")).toBe(true);
    expect(isFileMimeGroup("archive")).toBe(false);
    expect(isFileQueryStatus("warning")).toBe(true);
    expect(isFileQueryStatus("done")).toBe(false);
    expect(isFileQuerySort("relevance")).toBe(true);
    expect(isFileQuerySort("createdAt")).toBe(false);
  });
});

describe("文件查询游标", () => {
  it("往返编解码", () => {
    const cursor = { sort: "relevance" as const, rank: 2, updatedAt: 1789458311787, id: "file-9" };
    expect(decodeFileQueryCursor(encodeFileQueryCursor(cursor))).toEqual(cursor);
  });

  it("名称排序的游标保留小写名称", () => {
    const cursor = { sort: "name" as const, name: "数据结构讲义.md", id: "file-3" };
    expect(decodeFileQueryCursor(encodeFileQueryCursor(cursor))).toEqual(cursor);
  });

  it("拒绝无法解析或字段缺失的游标", () => {
    expect(() => decodeFileQueryCursor("not-base64-json")).toThrow(FileQueryInputError);
    expect(() =>
      decodeFileQueryCursor(Buffer.from(JSON.stringify({ sort: "recent" })).toString("base64url"))
    ).toThrow(FileQueryInputError);
    expect(() =>
      decodeFileQueryCursor(
        Buffer.from(JSON.stringify({ sort: "name", id: "f1" })).toString("base64url")
      )
    ).toThrow(FileQueryInputError);
  });

  it("游标排序方式与请求不一致时拒绝，而不是静默重排", async () => {
    const { client } = createClient([]);
    const cursor = encodeFileQueryCursor({ sort: "name", name: "a.md", id: "file-1" });
    await expect(
      queryFiles({ userId: "user-1", cursor }, client)
    ).rejects.toThrow("游标与当前排序方式不一致");
  });
});

describe("文件查询 SQL 构造", () => {
  it("无关键词时按更新时间排序，不做命中分级", async () => {
    const { client, queries } = createClient([fileRow()]);
    await queryFiles({ userId: "user-1" }, client);

    expect(queries[0].sql).toContain('ORDER BY matched.rank ASC, matched."updatedAt" DESC');
    expect(queries[0].sql).toContain('f."userId" = ?');
    expect(queries[0].values).toContain("user-1");
  });

  it("有关键词时生成命中分级与上下文片段", async () => {
    const { client, queries } = createClient([fileRow({ rank: 2, matchKind: "filename" })]);
    await queryFiles({ userId: "user-1", q: "数据结构" }, client);

    expect(queries[0].sql).toContain('WHEN lower(f."originalName") = ?');
    expect(queries[0].sql).toContain("THEN 'filename'");
    expect(queries[0].sql).toContain('strpos(lower(f."textContent"), lower(?)');
    // 关键词同时进入匹配条件与分级表达式
    expect(queries[0].values.filter((value) => value === "数据结构").length).toBeGreaterThan(1);
  });

  it("转义 LIKE 元字符，避免用户输入被当成通配符", async () => {
    const { client, queries } = createClient([]);
    await queryFiles({ userId: "user-1", q: "50%_a" }, client);

    const patterns = queries[0].values.filter(
      (value): value is string => typeof value === "string" && value.includes("\\%")
    );
    expect(patterns).toContain("%50\\%\\_a%");
    expect(patterns).toContain("50\\%\\_a%");
  });

  it("筛选条件逐项进入 SQL", async () => {
    const { client, queries } = createClient([]);
    await queryFiles(
      {
        userId: "user-1",
        projectId: "project-9",
        category: "实验",
        mimeGroup: "image",
        status: "warning",
      },
      client
    );

    expect(queries[0].values).toContain("project-9");
    expect(queries[0].values).toContain("实验");
    expect(queries[0].values).toContain("image/png");
    expect(queries[0].sql).toContain("parseReport");
  });

  it("内部聚合查询可一次覆盖多个 MIME 分组", async () => {
    const { client, queries } = createClient([]);
    await queryFiles(
      {
        userId: "user-1",
        mimeGroups: ["document", "text", "code"],
      },
      client
    );

    expect(queries[0].values).toContain("application/pdf");
    expect(queries[0].values).toContain("text/markdown");
    expect(queries[0].values).toContain("text/x-python");
  });

  it("请求条数按 limit + 1 取，用于判断是否还有下一页", async () => {
    const { client, queries } = createClient([]);
    await queryFiles({ userId: "user-1", limit: 5 }, client);
    expect(queries[0].values).toContain(6);
  });
});

describe("文件查询分页", () => {
  it("还有下一页时返回游标，最后一页返回 null", async () => {
    const rows = [fileRow({ id: "f1" }), fileRow({ id: "f2" }), fileRow({ id: "f3" })];

    const first = createClient(rows);
    const page = await queryFiles({ userId: "user-1", limit: 2 }, first.client);
    expect(page.files).toHaveLength(2);
    expect(page.nextCursor).not.toBeNull();
    expect(decodeFileQueryCursor(page.nextCursor!)).toMatchObject({ rank: 0, id: "f2" });

    const last = createClient([fileRow({ id: "f9" })]);
    const lastPage = await queryFiles({ userId: "user-1", limit: 2 }, last.client);
    expect(lastPage.files).toHaveLength(1);
    expect(lastPage.nextCursor).toBeNull();
  });

  it("把查询结果映射成客户端 DTO", async () => {
    const { client } = createClient([fileRow({ rank: 3, matchKind: "project", snippet: "命中片段" })]);
    const page = await queryFiles({ userId: "user-1", q: "408" }, client);

    expect(page.files[0]).toMatchObject({
      id: "file-1",
      originalName: "数据结构讲义.md",
      projectName: "408 复习",
      projectId: "project-1",
      hasParsedContent: true,
      hasEnhancedContent: false,
      warningCount: 0,
      embeddingStatus: "complete",
      matchKind: "project",
      snippet: "命中片段",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-02T00:00:00.000Z",
    });
  });

  it("名称排序使用名称游标", async () => {
    const { client, queries } = createClient([
      fileRow({ id: "f1", originalName: "A.md" }),
      fileRow({ id: "f2", originalName: "B.md" }),
    ]);
    const page = await queryFiles({ userId: "user-1", sort: "name", limit: 1 }, client);

    expect(queries[0].sql).toContain("ORDER BY lower(matched.\"originalName\") ASC");
    expect(decodeFileQueryCursor(page.nextCursor!)).toEqual({
      sort: "name",
      name: "a.md",
      id: "f1",
    });
  });
});
