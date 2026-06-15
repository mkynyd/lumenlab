import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/db";

export const getConversation = cache(
  async (id: string, userId: string) =>
    prisma.conversation.findFirst({
      where: { id, userId },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            role: true,
            content: true,
            reasoningContent: true,
            tokenCount: true,
            cacheHitTokens: true,
            cacheMissTokens: true,
          },
        },
      },
    })
);

export const getConversations = cache(async (userId: string) =>
  prisma.conversation.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take: 100,
  })
);
