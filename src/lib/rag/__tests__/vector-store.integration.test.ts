import { randomUUID } from "node:crypto";

import "dotenv/config";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { createDocumentChunks } from "@/lib/rag/vector-store";

async function createFixture() {
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: {
      email: `chunk-owner-${suffix}@example.test`,
      passwordHash: "integration-only",
    },
  });
  const project = await prisma.project.create({
    data: { userId: user.id, name: "Chunk rebuild fixture" },
  });
  const file = await prisma.fileAsset.create({
    data: {
      userId: user.id,
      projectId: project.id,
      filename: `chunks-${suffix}.md`,
      originalName: "分块重建测试.md",
      mimeType: "text/markdown",
      size: 64,
      storagePath: `integration/chunks-${suffix}.md`,
      textContent: "initial",
      contentFingerprint: "sha256:initial",
      status: "parsed",
    },
  });
  return { user, project, file };
}

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("createDocumentChunks atomic rebuild", () => {
  it("replaces the previous chunk set with no leftover half-written rows", async () => {
    const { user, project, file } = await createFixture();
    try {
      const firstCount = await createDocumentChunks({
        fileAssetId: file.id,
        projectId: project.id,
        userId: user.id,
        textContent: "第一版内容：基尔霍夫电流定律。",
        title: file.originalName,
      });
      expect(firstCount).toBeGreaterThan(0);

      const secondCount = await createDocumentChunks({
        fileAssetId: file.id,
        projectId: project.id,
        userId: user.id,
        textContent: "第二版内容：节点电压法。",
        title: file.originalName,
      });
      const rows = await prisma.documentChunk.findMany({
        where: { fileAssetId: file.id },
        select: { content: true },
      });
      expect(rows.length).toBe(secondCount);
      expect(rows.map((row) => row.content)).toContain(
        "第二版内容：节点电压法。"
      );
      expect(rows.map((row) => row.content)).not.toContain("第一版内容");
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  it("rolls back the delete when the rebuild fails mid-transaction", async () => {
    const { user, project, file } = await createFixture();
    try {
      const initialCount = await createDocumentChunks({
        fileAssetId: file.id,
        projectId: project.id,
        userId: user.id,
        textContent: "旧索引内容。",
        title: file.originalName,
      });
      expect(initialCount).toBeGreaterThan(0);

      const originalTransaction = prisma.$transaction.bind(prisma);
      const injected = vi
        .spyOn(prisma, "$transaction")
        .mockImplementationOnce(
          (async (callback: unknown, options?: unknown) =>
            originalTransaction(async (tx: Prisma.TransactionClient) => {
              // The rebuild's delete runs inside the transaction, then the
              // injected failure aborts it — old rows must survive.
              await tx.documentChunk.deleteMany({
                where: { fileAssetId: file.id, userId: user.id },
              });
              throw new Error("injected rebuild failure");
            }, options as never)) as typeof prisma.$transaction
        );

      await expect(
        createDocumentChunks({
          fileAssetId: file.id,
          projectId: project.id,
          userId: user.id,
          textContent: "会失败的新版本。",
          title: file.originalName,
        })
      ).rejects.toThrow("injected rebuild failure");
      expect(injected).toHaveBeenCalled();

      const rows = await prisma.documentChunk.findMany({
        where: { fileAssetId: file.id },
        select: { content: true },
      });
      expect(rows.length).toBe(initialCount);
      expect(rows.map((row) => row.content)).toContain("旧索引内容。");
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});
