import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

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
          createdAt: true,
        },
      },
    },
  });

  if (!conversation) {
    return NextResponse.json({ error: "对话不存在" }, { status: 404 });
  }

  return NextResponse.json({ conversation });
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

  await prisma.conversation.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
