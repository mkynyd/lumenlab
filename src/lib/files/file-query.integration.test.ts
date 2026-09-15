import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import { queryFiles, type FileQueryClient } from "@/lib/files/file-query";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const client = prisma as unknown as FileQueryClient;

const createdUserIds: string[] = [];

async function createOwner() {
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: {
      email: `file-query-${suffix}@example.test`,
      passwordHash: "integration-only",
    },
  });
  createdUserIds.push(user.id);
  return user;
}

async function createFile(input: {
  userId: string;
  projectId?: string | null;
  originalName: string;
  mimeType?: string;
  category?: string | null;
  status?: string;
  textContent?: string | null;
  embeddingStatus?: string;
  warningCount?: number;
  updatedAt: Date;
}) {
  return prisma.fileAsset.create({
    data: {
      userId: input.userId,
      projectId: input.projectId ?? null,
      filename: `stored-${randomUUID()}`,
      originalName: input.originalName,
      mimeType: input.mimeType ?? "text/markdown",
      size: 1024,
      storageProvider: "local",
      storagePath: `uploads/${randomUUID()}`,
      status: input.status ?? "parsed",
      category: input.category ?? null,
      textContent: input.textContent ?? null,
      processingMetadata: {
        ...(input.embeddingStatus ? { embeddingStatus: input.embeddingStatus } : {}),
        ...(input.warningCount !== undefined
          ? { parseReport: { warningCount: input.warningCount } }
          : {}),
      },
      updatedAt: input.updatedAt,
    },
  });
}

function at(minutesAgo: number): Date {
  return new Date(Date.now() - minutesAgo * 60_000);
}

describe("跨项目文件查询", () => {
  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;
  });

  afterEach(async () => {
    if (createdUserIds.length === 0) return;
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdUserIds.length = 0;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await pool.end();
  });

  it("按命中层级排序：完全命中 > 前缀 > 包含 > 项目名 > 正文", async () => {
    const user = await createOwner();
    const project = await prisma.project.create({
      data: { userId: user.id, name: "操作系统课程" },
    });

    await createFile({ userId: user.id, originalName: "无关.md", textContent: "本文讨论操作系统", updatedAt: at(1) });
    await createFile({ userId: user.id, originalName: "我的操作系统笔记.md", updatedAt: at(2) });
    await createFile({ userId: user.id, projectId: project.id, originalName: "课程大纲.md", updatedAt: at(3) });
    await createFile({ userId: user.id, originalName: "操作系统实验.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", updatedAt: at(4) });
    await createFile({ userId: user.id, originalName: "操作系统", updatedAt: at(5) });

    const page = await queryFiles({ userId: user.id, q: "操作系统" }, client);

    expect(page.files.map((file) => file.originalName)).toEqual([
      "操作系统",
      "操作系统实验.docx",
      "我的操作系统笔记.md",
      "课程大纲.md",
      "无关.md",
    ]);
    expect(page.files.map((file) => file.matchKind)).toEqual([
      "filename",
      "filename",
      "filename",
      "project",
      "content",
    ]);
  });

  it("正文命中返回上下文片段而不是全文", async () => {
    const user = await createOwner();
    const body = `${"前".repeat(200)}关键结论在这里${"后".repeat(200)}`;
    await createFile({ userId: user.id, originalName: "报告.md", textContent: body, updatedAt: at(1) });

    const page = await queryFiles({ userId: user.id, q: "关键结论" }, client);

    expect(page.files).toHaveLength(1);
    const snippet = page.files[0].snippet ?? "";
    expect(snippet).toContain("关键结论");
    expect(snippet.length).toBeLessThan(body.length);
  });

  it("游标翻页不重复也不漏项", async () => {
    const user = await createOwner();
    for (let index = 0; index < 5; index += 1) {
      await createFile({
        userId: user.id,
        originalName: `讲义-${index}.md`,
        updatedAt: at(index),
      });
    }

    const collected: string[] = [];
    let cursor: string | null = null;
    let pageCount = 0;
    do {
      const page = await queryFiles(
        { userId: user.id, limit: 2, cursor },
        client
      );
      collected.push(...page.files.map((file) => file.id));
      cursor = page.nextCursor;
      pageCount += 1;
      expect(pageCount).toBeLessThanOrEqual(5);
    } while (cursor);

    expect(collected).toHaveLength(5);
    expect(new Set(collected).size).toBe(5);
    expect(pageCount).toBe(3);
  });

  it("关键词下的分页同样保持命中分级顺序", async () => {
    const user = await createOwner();
    for (let index = 0; index < 3; index += 1) {
      await createFile({
        userId: user.id,
        originalName: `线性代数-${index}.md`,
        updatedAt: at(index),
      });
    }
    await createFile({
      userId: user.id,
      originalName: "无关.md",
      textContent: "线性代数复习要点",
      updatedAt: at(9),
    });

    const first = await queryFiles({ userId: user.id, q: "线性代数", limit: 2 }, client);
    const second = await queryFiles(
      { userId: user.id, q: "线性代数", limit: 2, cursor: first.nextCursor },
      client
    );

    const names = [...first.files, ...second.files].map((file) => file.originalName);
    expect(names).toEqual([
      "线性代数-0.md",
      "线性代数-1.md",
      "线性代数-2.md",
      "无关.md",
    ]);
    expect(second.nextCursor).toBeNull();
  });

  it("只返回当前用户的文件", async () => {
    const owner = await createOwner();
    const stranger = await createOwner();
    await createFile({ userId: owner.id, originalName: "我的讲义.md", updatedAt: at(1) });
    await createFile({ userId: stranger.id, originalName: "别人的讲义.md", updatedAt: at(1) });

    const page = await queryFiles({ userId: owner.id, q: "讲义" }, client);

    expect(page.files.map((file) => file.originalName)).toEqual(["我的讲义.md"]);
  });

  it("按项目、分类、类型与状态筛选", async () => {
    const user = await createOwner();
    const project = await prisma.project.create({
      data: { userId: user.id, name: "数据结构" },
    });

    await createFile({ userId: user.id, projectId: project.id, originalName: "讲义.md", category: "讲义", mimeType: "text/markdown", updatedAt: at(1) });
    await createFile({ userId: user.id, originalName: "课件.pdf", category: "课件", mimeType: "application/pdf", updatedAt: at(2) });
    await createFile({ userId: user.id, originalName: "截图.png", category: "课件", mimeType: "image/png", updatedAt: at(3) });
    await createFile({ userId: user.id, originalName: "有警告.md", category: "讲义", warningCount: 2, updatedAt: at(4) });
    await createFile({ userId: user.id, originalName: "失败.md", category: "讲义", status: "failed", updatedAt: at(5) });
    await createFile({ userId: user.id, originalName: "索引不全.md", category: "讲义", embeddingStatus: "partial", updatedAt: at(6) });

    const byProject = await queryFiles({ userId: user.id, projectId: project.id }, client);
    expect(byProject.files.map((file) => file.originalName)).toEqual(["讲义.md"]);

    const byCategory = await queryFiles({ userId: user.id, category: "课件" }, client);
    expect(byCategory.files.map((file) => file.originalName)).toEqual(["课件.pdf", "截图.png"]);

    const byMimeGroup = await queryFiles({ userId: user.id, mimeGroup: "image" }, client);
    expect(byMimeGroup.files.map((file) => file.originalName)).toEqual(["截图.png"]);

    const byStatus = await queryFiles({ userId: user.id, status: "warning" }, client);
    expect(byStatus.files.map((file) => file.originalName)).toEqual(["有警告.md"]);

    const parsedOnly = await queryFiles({ userId: user.id, status: "parsed" }, client);
    expect(parsedOnly.files.map((file) => file.originalName)).not.toContain("有警告.md");
    expect(parsedOnly.files.map((file) => file.originalName)).not.toContain("失败.md");

    const incomplete = await queryFiles({ userId: user.id, status: "index-incomplete" }, client);
    expect(incomplete.files.map((file) => file.originalName)).toEqual(["索引不全.md"]);

    const failed = await queryFiles({ userId: user.id, status: "failed" }, client);
    expect(failed.files.map((file) => file.originalName)).toEqual(["失败.md"]);
  });

  it("LIKE 元字符按字面匹配", async () => {
    const user = await createOwner();
    await createFile({ userId: user.id, originalName: "成绩50%统计.md", updatedAt: at(1) });
    await createFile({ userId: user.id, originalName: "成绩5000统计.md", updatedAt: at(2) });

    const page = await queryFiles({ userId: user.id, q: "50%" }, client);

    expect(page.files.map((file) => file.originalName)).toEqual(["成绩50%统计.md"]);
  });

  it("按文件名排序时分页同样稳定", async () => {
    const user = await createOwner();
    for (const name of ["C.md", "A.md", "b.md"]) {
      await createFile({ userId: user.id, originalName: name, updatedAt: at(1) });
    }

    const first = await queryFiles({ userId: user.id, sort: "name", limit: 2 }, client);
    const second = await queryFiles(
      { userId: user.id, sort: "name", limit: 2, cursor: first.nextCursor },
      client
    );

    const names = [...first.files, ...second.files].map((file) => file.originalName);
    expect(names).toEqual(["A.md", "b.md", "C.md"]);
  });
});
