/**
 * 工具共享工具：参数边界、跨租户预校验
 */

import { prisma } from "@/lib/db";

export async function assertProjectOwned(
  userId: string,
  projectId: string
): Promise<void> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
    select: { id: true },
  });
  if (!project) {
    throw new Error("项目不存在或无访问权限");
  }
}

export async function assertFileOwned(
  userId: string,
  fileId: string,
  projectId?: string
): Promise<{ id: string; originalName: string; mimeType: string }> {
  const file = await prisma.fileAsset.findFirst({
    where: {
      id: fileId,
      userId,
      ...(projectId ? { projectId } : {}),
    },
    select: { id: true, originalName: true, mimeType: true },
  });
  if (!file) throw new Error("文件不存在或无访问权限");
  return file;
}