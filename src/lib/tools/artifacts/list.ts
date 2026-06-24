import { prisma } from "@/lib/db";

export async function listArtifacts(
  userId: string,
  projectId?: string,
  conversationId?: string
): Promise<Record<string, unknown>> {
  const artifacts = await prisma.artifact.findMany({
    where: {
      userId,
      ...(projectId ? { projectId } : {}),
      ...(conversationId ? { conversationId } : {}),
    },
    select: {
      id: true,
      title: true,
      type: true,
      format: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return {
    artifacts: artifacts.map((a) => ({
      id: a.id,
      title: a.title,
      type: a.type,
      format: a.format,
      createdAt: a.createdAt.toISOString(),
    })),
    count: artifacts.length,
  };
}