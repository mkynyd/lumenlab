import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { chatMessageSelect, toChatMessage } from "@/lib/data/conversations";
import { deleteConversationAttachmentObjects } from "@/lib/chat/message-attachments";

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
      messages: { orderBy: { createdAt: "asc" }, select: chatMessageSelect(session.user.id) },
    },
  });

  if (!conversation) {
    return NextResponse.json({ error: "对话不存在" }, { status: 404 });
  }

  return NextResponse.json({
    conversation: {
      ...conversation,
      messages: conversation.messages.map(toChatMessage),
    },
  });
}

// PATCH — 重命名对话（用户手动命名后，标题生成不再覆盖）
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const { id } = await params;
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });
  }
  const rawTitle =
    typeof payload === "object" && payload !== null && "title" in payload
      ? (payload as { title?: unknown }).title
      : undefined;
  if (typeof rawTitle !== "string") {
    return NextResponse.json({ error: "标题不能为空" }, { status: 400 });
  }
  const title = Array.from(rawTitle.replace(/\s+/g, " ").trim())
    .slice(0, 40)
    .join("");
  if (!title) {
    return NextResponse.json({ error: "标题不能为空" }, { status: 400 });
  }

  const updated = await prisma.conversation.updateMany({
    where: { id, userId: session.user.id },
    data: { title },
  });
  if (updated.count === 0) {
    return NextResponse.json({ error: "对话不存在" }, { status: 404 });
  }

  return NextResponse.json({ title });
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
