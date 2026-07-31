import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function createOwnedProject() {
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: {
      email: `learning-contract-${suffix}@example.test`,
      passwordHash: "integration-only",
    },
  });
  const project = await prisma.project.create({
    data: {
      userId: user.id,
      name: "Learning contract integration fixture",
    },
  });
  return { user, project };
}

describe("learning and durable database contracts", () => {
  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await pool.end();
  });

  it("allows only one concurrent active goal per project", async () => {
    const { user, project } = await createOwnedProject();
    try {
      const results = await Promise.allSettled([
        prisma.learningGoal.create({
          data: {
            userId: user.id,
            projectId: project.id,
            title: "Goal A",
            idempotencyKey: `goal-a-${randomUUID()}`,
          },
        }),
        prisma.learningGoal.create({
          data: {
            userId: user.id,
            projectId: project.id,
            title: "Goal B",
            idempotencyKey: `goal-b-${randomUUID()}`,
          },
        }),
      ]);

      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(
        1
      );
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(
        1
      );
      await expect(
        prisma.learningGoal.count({
          where: { projectId: project.id, status: "active" },
        })
      ).resolves.toBe(1);
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  it("serializes nonterminal agent runs within a conversation", async () => {
    const { user, project } = await createOwnedProject();
    try {
      const conversation = await prisma.conversation.create({
        data: {
          userId: user.id,
          projectId: project.id,
          title: "Durable contract fixture",
        },
      });

      const results = await Promise.allSettled([
        prisma.agentExecution.create({
          data: {
            userId: user.id,
            conversationId: conversation.id,
            projectId: project.id,
            clientRunKey: `run-a-${randomUUID()}`,
            requestHash: "sha256:a",
          },
        }),
        prisma.agentExecution.create({
          data: {
            userId: user.id,
            conversationId: conversation.id,
            projectId: project.id,
            clientRunKey: `run-b-${randomUUID()}`,
            requestHash: "sha256:b",
          },
        }),
      ]);

      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(
        1
      );
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(
        1
      );
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  it("retains source snapshots after a file is deleted and removes them with the project", async () => {
    const { user, project } = await createOwnedProject();
    try {
      const file = await prisma.fileAsset.create({
        data: {
          userId: user.id,
          projectId: project.id,
          filename: "lecture.md",
          originalName: "lecture.md",
          mimeType: "text/markdown",
          size: 7,
          storagePath: "integration/lecture.md",
          textContent: "lecture",
          contentFingerprint: "sha256:file",
          status: "parsed",
        },
      });
      const anchor = await prisma.sourceAnchor.create({
        data: {
          projectId: project.id,
          anchorKey: `anchor-${randomUUID()}`,
          fileAssetId: file.id,
          originalFileAssetId: file.id,
          sourceFileName: file.originalName,
          locator: { lineStart: 1, lineEnd: 1 },
          contentFingerprint: "sha256:file",
          excerptHash: "sha256:excerpt",
        },
      });

      await prisma.fileAsset.delete({ where: { id: file.id } });

      await expect(
        prisma.sourceAnchor.findUniqueOrThrow({ where: { id: anchor.id } })
      ).resolves.toMatchObject({
        fileAssetId: null,
        originalFileAssetId: file.id,
        contentFingerprint: "sha256:file",
        excerptHash: "sha256:excerpt",
      });

      await prisma.project.delete({ where: { id: project.id } });
      await expect(
        prisma.sourceAnchor.findUnique({ where: { id: anchor.id } })
      ).resolves.toBeNull();
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});
