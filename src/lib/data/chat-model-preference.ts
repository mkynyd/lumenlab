import "server-only";
import { prisma } from "@/lib/db";
import { chatModelForPreference } from "@/lib/chat/model-catalog";

/** Called only when a request omits its model. Read owned preferences without rewriting history. */
export async function resolveStoredChatModel(
  userId: string,
  context: { conversationId?: string; projectId?: string }
): Promise<string> {
  if (context.conversationId) {
    const conversation = await prisma.conversation.findFirst({
      where: { id: context.conversationId, userId },
      select: { model: true },
    });
    if (!conversation) throw new Error("对话不存在或无权访问");
    return chatModelForPreference(conversation.model);
  }
  if (context.projectId) {
    const project = await prisma.project.findFirst({
      where: { id: context.projectId, userId },
      select: { defaultModel: true },
    });
    if (!project) throw new Error("项目不存在或无权访问");
    return chatModelForPreference(project.defaultModel);
  }
  return chatModelForPreference();
}
