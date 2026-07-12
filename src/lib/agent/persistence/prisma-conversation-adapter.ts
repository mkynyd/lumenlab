import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import type {
  ConversationPersistence,
  ConversationState,
} from "./conversation-persistence";

export class PrismaConversationAdapter implements ConversationPersistence {
  findOwnedConversation(input: {
    conversationId: string;
    userId: string;
  }): Promise<ConversationState | null> {
    return prisma.conversation.findFirst({
      where: { id: input.conversationId, userId: input.userId },
    });
  }

  createConversation(input: {
    userId: string;
    projectId?: string;
    title: string;
    model: string;
    thinkingEnabled: boolean;
  }): Promise<ConversationState> {
    return prisma.conversation.create({
      data: {
        userId: input.userId,
        title: input.title,
        model: input.model,
        thinkingEnabled: input.thinkingEnabled,
        projectId: input.projectId ?? null,
      },
    });
  }

  updateModelPreferences(input: {
    conversationId: string;
    model: string;
    thinkingEnabled: boolean;
  }): Promise<ConversationState> {
    return prisma.conversation.update({
      where: { id: input.conversationId },
      data: {
        model: input.model,
        thinkingEnabled: input.thinkingEnabled,
      },
    });
  }

  lockModel(input: {
    conversationId: string;
    provider: string;
  }): Promise<ConversationState> {
    return prisma.conversation.update({
      where: { id: input.conversationId },
      data: { modelLock: input.provider },
    });
  }

  updateSkillState(input: {
    conversationId: string;
    activeSkillId: string | null;
    activeSkillVersion: string | null;
    activeSkillSource: string | null;
    activeSkillStatus: string | null;
    skillDisabled?: boolean;
  }): Promise<ConversationState> {
    return prisma.conversation.update({
      where: { id: input.conversationId },
      data: {
        activeSkillId: input.activeSkillId,
        activeSkillVersion: input.activeSkillVersion,
        activeSkillSource: input.activeSkillSource,
        activeSkillStatus: input.activeSkillStatus,
        ...(input.skillDisabled === undefined
          ? {}
          : { skillDisabled: input.skillDisabled }),
      },
    });
  }

  async recordSkillActivation(input: {
    conversationId: string;
    skillId: string;
    version: string;
    source: string;
    statusAtActivation: string;
    confidence: number;
    reason: string;
    missingInfo: string[];
  }) {
    await prisma.conversationSkill.create({
      data: {
        conversationId: input.conversationId,
        skillId: input.skillId,
        version: input.version,
        source: input.source,
        statusAtActivation: input.statusAtActivation,
        confidence: input.confidence,
        reason: input.reason,
        missingInfo: input.missingInfo as Prisma.InputJsonValue,
      },
    });
  }

  async deactivateSkill(input: {
    conversationId: string;
    skillId: string;
  }) {
    await prisma.conversationSkill.updateMany({
      where: {
        conversationId: input.conversationId,
        skillId: input.skillId,
        deactivatedAt: null,
      },
      data: { deactivatedAt: new Date() },
    });
  }

  loadHistory(conversationId: string) {
    return prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
      select: { role: true, content: true },
    });
  }

  async createUserMessage(input: {
    conversationId: string;
    content: string;
  }) {
    await prisma.message.create({
      data: {
        conversationId: input.conversationId,
        role: "user",
        content: input.content,
      },
    });
  }

  async createContextSummary(input: {
    conversationId: string;
    content: string;
    compressedCount: number;
  }) {
    await prisma.message.create({
      data: {
        conversationId: input.conversationId,
        role: "system",
        content: input.content,
        subtype: "context-summary",
        metadata: {
          compressedCount: input.compressedCount,
        } as Prisma.InputJsonValue,
      },
    });
  }

  createAssistantMessage(input: {
    conversationId: string;
    sources: import("../sources").AgentSource[];
  }) {
    return prisma.message.create({
      data: {
        conversationId: input.conversationId,
        role: "assistant",
        content: "",
        sources: input.sources as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
  }

  async completeAssistantMessage(input: {
    messageId: string;
    content: string;
    reasoningContent: string | null;
    tokenCount: number | null;
    provider: string;
    cacheHitTokens: number | null;
    cacheMissTokens: number | null;
    sources: import("../sources").AgentSource[];
  }) {
    await prisma.message.update({
      where: { id: input.messageId },
      data: {
        content: input.content,
        reasoningContent: input.reasoningContent,
        tokenCount: input.tokenCount,
        provider: input.provider,
        cacheHitTokens: input.cacheHitTokens,
        cacheMissTokens: input.cacheMissTokens,
        sources: input.sources as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async deleteMessage(messageId: string) {
    await prisma.message.delete({ where: { id: messageId } });
  }

  async updateTitle(input: { conversationId: string; title: string }) {
    await prisma.conversation.update({
      where: { id: input.conversationId },
      data: { title: input.title },
    });
  }

  async touchConversation(conversationId: string) {
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });
  }
}
