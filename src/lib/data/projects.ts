import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/db";

export const getProject = cache(async (id: string, userId: string) =>
  prisma.project.findFirst({
    where: { id, userId },
    include: {
      files: { orderBy: { createdAt: "desc" } },
      conversations: { orderBy: { updatedAt: "desc" } },
      _count: { select: { conversations: true, files: true } },
    },
  })
);

export const getProjects = cache(async (userId: string) =>
  prisma.project.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { conversations: true, files: true } },
    },
  })
);

export const getProjectFiles = cache(
  async (projectId: string, userId: string) =>
    prisma.fileAsset.findMany({
      where: { projectId, userId },
      orderBy: { createdAt: "desc" },
    })
);
