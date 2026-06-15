import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/db";

export const getMessages = cache(
  async (conversationId: string, userId: string) =>
    prisma.message.findMany({
      where: { conversationId, conversation: { userId } },
      orderBy: { createdAt: "asc" },
    })
);
