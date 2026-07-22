import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getProviderApiKey } from "@/lib/data/provider-access";
import { createTextMessage } from "@/lib/deepseek";
import {
  NEW_CONVERSATION_TITLE,
  conversationTitleFallback,
  normalizeConversationTitle,
} from "@/lib/conversation-title";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const { id } = await params;
  const conversation = await prisma.conversation.findFirst({
    where: { id, userId: session.user.id },
    select: {
      id: true,
      title: true,
      messages: {
        where: { role: "user" },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { content: true },
      },
    },
  });
  if (!conversation) {
    return NextResponse.json({ error: "对话不存在" }, { status: 404 });
  }

  const firstMessage = conversation.messages[0]?.content ?? "";
  const rawPromptTitle = conversationTitleFallback(firstMessage);
  // A generated/manual title must never be overwritten by a late request.
  if (
    !firstMessage ||
    (conversation.title !== NEW_CONVERSATION_TITLE &&
      conversation.title !== rawPromptTitle)
  ) {
    return NextResponse.json({ title: conversation.title, generated: false });
  }

  let title = rawPromptTitle;
  try {
    const apiKey = await getProviderApiKey(session.user.id, "deepseek");
    const output = await createTextMessage(apiKey, {
      // `deepseek-v4-flash` is the application's DeepSeek V4 Light lane.
      model: "deepseek-v4-flash",
      maxTokens: 48,
      temperature: 0.1,
      system:
        "你为学习工作台生成对话导航标题。只输出标题本身，不要解释、引号、标点前缀或换行。",
      prompt:
        `将下面首条消息概括成一个不超过 10 个词的中文短标题。保留任务主题，不复述整句。\n\n${firstMessage}`,
    });
    title = normalizeConversationTitle(output, rawPromptTitle);
  } catch {
    // Title generation is strictly best-effort and must not affect chat.
  }

  const updated = await prisma.conversation.updateMany({
    where: {
      id: conversation.id,
      userId: session.user.id,
      title: conversation.title,
    },
    data: { title },
  });

  return NextResponse.json({
    title: updated.count === 1 ? title : conversation.title,
    generated: updated.count === 1,
  });
}
