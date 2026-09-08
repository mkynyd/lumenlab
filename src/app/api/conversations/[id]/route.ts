import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { hydrateAssistantProcess } from "@/lib/agent/assistant-process";
import {
  CHAT_ATTACHMENT_SELECT,
  toChatAttachmentDtos,
  deleteConversationAttachmentObjects,
} from "@/lib/chat/message-attachments";

// GET — 获取对话及其消息
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const { id } = await params;

  const conversation = await prisma.conversation.findFirst({
    where: { id, userId: session.user.id },
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
          createdAt: true,
          attachments: CHAT_ATTACHMENT_SELECT,
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

  if (!conversation) {
    return NextResponse.json({ error: "对话不存在" }, { status: 404 });
  }

  return NextResponse.json({
    conversation: {
      ...conversation,
      messages: conversation.messages.map((message) => ({
        ...message,
        attachments: toChatAttachmentDtos(message.attachments),
        process: hydrateAssistantProcess(
          message.agentExecutionsAsAssistantMessage?.[0]?.events ?? []
        ),
        agentExecutionsAsAssistantMessage: undefined,
      })),
    },
  });
}

// DELETE — 删除对话
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const { id } = await params;

  const conversation = await prisma.conversation.findFirst({
    where: { id, userId: session.user.id },
  });

  if (!conversation) {
    return NextResponse.json({ error: "对话不存在" }, { status: 404 });
  }

  // 任务 08：先回收该会话 own 的附件对象，再删除会话（附件行随消息级联删除）。
  // 仍被其他消息/项目文件引用的共享对象会被保留。
  await deleteConversationAttachmentObjects({
    userId: session.user.id,
    conversationId: id,
  });
  await prisma.conversation.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
