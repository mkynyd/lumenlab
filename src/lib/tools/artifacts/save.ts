import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { assertProjectOwned } from "@/lib/tools/shared/sanitize";

export async function saveArtifact(
  userId: string,
  projectId: string | undefined,
  conversationId: string | undefined,
  messageId: string | undefined,
  args: {
    title: string;
    type?: string;
    format?: string;
    content: string;
  }
): Promise<Record<string, unknown>> {
  if (projectId) {
    await assertProjectOwned(userId, projectId);
  }

  const message = messageId
    ? await prisma.message.findFirst({
        where: { id: messageId, conversationId },
        select: { sources: true },
      })
    : null;
  const artifact = await prisma.artifact.create({
    data: {
      userId,
      projectId: projectId ?? null,
      conversationId: conversationId ?? null,
      messageId: messageId ?? null,
      title: args.title.slice(0, 200),
      type: args.type ?? "general",
      format: args.format ?? "markdown",
      content: args.content,
      metadata: message?.sources
        ? ({ sources: message.sources } as Prisma.InputJsonValue)
        : undefined,
    },
    select: { id: true, title: true, type: true, createdAt: true },
  });
  return {
    id: artifact.id,
    title: artifact.title,
    type: artifact.type,
    createdAt: artifact.createdAt.toISOString(),
  };
}
