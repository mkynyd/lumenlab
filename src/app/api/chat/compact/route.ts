import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getProviderApiKey } from "@/lib/data/provider-access";
import { ProviderAccessError } from "@/lib/provider-access";
import {
  compressHistory,
  buildCompressedMessages,
} from "@/lib/chat/compression";
import { checkContextBudget } from "@/lib/tokens";
import { logger } from "@/lib/logger";
import type { Prisma } from "@/generated/prisma/client";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const userId = session.user.id;

  let body: { conversationId?: string; prompt?: string } | null = null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "无效的请求格式" }, { status: 400 });
  }

  const conversationId = body?.conversationId;
  const prompt = typeof body?.prompt === "string" ? body.prompt : undefined;

  if (!conversationId || typeof conversationId !== "string") {
    return NextResponse.json({ error: "缺少 conversationId" }, { status: 400 });
  }

  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
  });
  if (!conversation) {
    return NextResponse.json({ error: "对话不存在" }, { status: 404 });
  }

  const history = await prisma.message.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true },
  });

  if (history.length === 0) {
    return NextResponse.json({ error: "对话没有消息" }, { status: 400 });
  }

  let apiKey: string;
  try {
    apiKey = await getProviderApiKey(userId, "deepseek");
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof ProviderAccessError
            ? error.message
            : "DeepSeek API Key 暂时不可用",
      },
      { status: 403 }
    );
  }

  try {
    const result = await compressHistory({
      apiKey,
      messages: history,
      userPrompt: prompt,
    });

    if (!result) {
      return NextResponse.json(
        { success: false, message: "没有需要压缩的内容" },
        { status: 200 }
      );
    }

    const summaryMessage = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "system",
        content: `【此前对话压缩上下文】\n${result.summary}\n\n请在后续回答中继承这些事实与约束。`,
        subtype: "context-summary",
        metadata: {
          compressedCount: result.compressedCount,
          userPrompt: prompt || null,
        } as Prisma.InputJsonValue,
      },
    });

    const reCheck = checkContextBudget(
      buildCompressedMessages(history, result.summary)
    );

    return NextResponse.json({
      success: true,
      messageId: summaryMessage.id,
      compressedCount: result.compressedCount,
      tokens: reCheck.tokens,
      ratio: reCheck.ratio,
    });
  } catch (err) {
    logger.error("手动压缩失败", { error: String(err), conversationId });
    return NextResponse.json(
      { error: "压缩失败，请稍后重试" },
      { status: 500 }
    );
  }
}
