import { prisma } from "@/lib/db";
import { assertProjectOwned } from "../shared/sanitize";

export async function listProjectFiles(
  userId: string,
  projectId: string
): Promise<Record<string, unknown>> {
  await assertProjectOwned(userId, projectId);
  const files = await prisma.fileAsset.findMany({
    where: { userId, projectId },
    select: {
      id: true,
      originalName: true,
      mimeType: true,
      size: true,
      status: true,
      category: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
  return {
    files: files.map((f) => ({
      id: f.id,
      name: f.originalName,
      mimeType: f.mimeType,
      sizeKb: Math.round(f.size / 1024),
      status: f.status,
      category: f.category,
    })),
    count: files.length,
  };
}