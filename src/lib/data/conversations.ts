import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/db";
import type { AgentSource } from "@/lib/agent/sources";
import { hydrateAssistantProcess } from "@/lib/agent/assistant-process";

function normalizeSources(value: unknown): AgentSource[] | null {
  return Array.isArray(value) ? (value as AgentSource[]) : null;
}

export const getConversation = cache(
  async (id: string, userId: string) => {
    const conversation = await prisma.conversation.findFirst({
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
            sources: true,
            agentExecutionsAsAssistantMessage: {
              take: 1,
              orderBy: { createdAt: "desc" },
              select: {
                events: {
                  orderBy: { sequence: "asc" },
                  select: { type: true, payload: true, createdAt: true },
                },
              },
            },
          },
        },
      },
    });
    if (!conversation) return null;
    return {
      ...conversation,
      messages: conversation.messages.map((message) => ({
        ...message,
        sources: normalizeSources(message.sources),
        process: hydrateAssistantProcess(
          message.agentExecutionsAsAssistantMessage?.[0]?.events ?? []
        ),
        agentExecutionsAsAssistantMessage: undefined,
      })),
    };
  }
);

export const getConversations = cache(async (userId: string) =>
  prisma.conversation.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take: 100,
  })
);
