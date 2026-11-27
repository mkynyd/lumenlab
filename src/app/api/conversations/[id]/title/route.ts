import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getProviderApiKey } from "@/lib/data/provider-access";
import { createTextMessage } from "@/lib/deepseek";
import { DEEPSEEK_CHAT_MODEL } from "@/lib/chat/model-catalog";
import {
  NEW_CONVERSATION_TITLE,
  conversationBootstrapTitle,
  sanitizeGeneratedTitle,
} from "@/lib/conversation-title";

const TITLE_SYSTEM_PROMPT = [
  "你为学习工作台生成对话导航标题。",
  "标题必须是一个具体的名词短语，点明任务主题或对象，例如“牛顿迭代法作业”“课程项目周报”。",
  "只输出标题本身，不要解释、引号、标点前缀或换行。",
  "禁止输出“信息不足”“无法概括”“无法总结”“抱歉”等拒答或空泛表达；即使用户消息很短，也要用其中的关键词概括。",
].join("");

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
        where: { role: { in: ["user", "assistant"] } },
        orderBy: { createdAt: "asc" },
        take: 4,
        select: {
          role: true,
          content: true,
          attachments: {
            orderBy: { position: "asc" },
            select: { originalName: true, kind: true },
          },
        },
      },
    },
  });
  if (!conversation) {
    return NextResponse.json({ error: "对话不存在" }, { status: 404 });
  }

  const firstUser = conversation.messages.find((message) => message.role === "user");
  const firstAssistant = conversation.messages.find(
    (message) => message.role === "assistant"
  );
  const firstMessage = firstUser?.content ?? "";
  const attachmentNames = (firstUser?.attachments ?? []).map(
    (attachment) => attachment.originalName
  );
  const bootstrapTitle = conversationBootstrapTitle(firstMessage, firstUser?.attachments ?? []);

  // 只处理机器生成的占位/无效标题；用户手动重命名或已生成的标题绝不覆盖。
  // 兼容旧数据：曾经把模型拒答写进数据库的标题也会被判为无效并重新生成。
  const currentTitleIsInvalid = !sanitizeGeneratedTitle(conversation.title);
  if (
    conversation.title !== NEW_CONVERSATION_TITLE &&
    conversation.title !== bootstrapTitle &&
    !currentTitleIsInvalid
  ) {
    return NextResponse.json({ title: conversation.title, generated: false });
  }

  if (!firstMessage.trim()) {
    const updated = await prisma.conversation.updateMany({
      where: {
        id: conversation.id,
        userId: session.user.id,
        title: conversation.title,
      },
      data: { title: bootstrapTitle },
    });
    return NextResponse.json({
      title: updated.count === 1 ? bootstrapTitle : conversation.title,
      generated: false,
    });
  }

  const prompt = [
    "根据下面的首条消息和首轮回答，生成一个不超过 10 个词的中文短标题。",
    "首条消息:",
    firstMessage.slice(0, 1200),
    attachmentNames.length > 0 ? `附件: ${attachmentNames.join("、")}` : "",
    firstAssistant
      ? `首轮回答摘要:\n${firstAssistant.content.replace(/\s+/g, " ").slice(0, 600)}`
      : "",
    "标题必须具体，不能用“信息不足/无法概括”这类表达；如果回答里有更清楚的主题词，可以据此精修。",
  ]
    .filter(Boolean)
    .join("\n");

  let apiKey: string | null = null;
  try {
    apiKey = await getProviderApiKey(session.user.id, "deepseek");
  } catch {
    // 标题生成是 best-effort，没有可用密钥时直接保留确定性标题。
  }

  let generatedTitle: string | null = null;
  if (apiKey) {
    for (let attempt = 0; attempt < 2 && !generatedTitle; attempt += 1) {
      try {
        const output = await createTextMessage(apiKey, {
          model: DEEPSEEK_CHAT_MODEL,
          maxTokens: 48,
          temperature: 0.1,
          system: TITLE_SYSTEM_PROMPT,
          prompt:
            attempt === 0
              ? prompt
              : `${prompt}\n上一次输出被判定为无效标题。请直接给出具体主题词，不要拒答。`,
        });
        generatedTitle = sanitizeGeneratedTitle(output);
      } catch {
        // 单次模型调用失败不阻塞对话；循环结束仍未生成时保留确定性标题。
      }
    }
  }

  if (!generatedTitle) {
    // 关键：没有合法标题时保留 bootstrapTitle，绝不把拒答写入数据库。
    if (conversation.title === bootstrapTitle) {
      return NextResponse.json({ title: conversation.title, generated: false });
    }
    const updated = await prisma.conversation.updateMany({
      where: {
        id: conversation.id,
        userId: session.user.id,
        title: conversation.title,
      },
      data: { title: bootstrapTitle },
    });
    return NextResponse.json({
      title: updated.count === 1 ? bootstrapTitle : conversation.title,
      generated: false,
    });
  }

  const updated = await prisma.conversation.updateMany({
    where: {
      id: conversation.id,
      userId: session.user.id,
      title: conversation.title,
    },
    data: { title: generatedTitle },
  });

  return NextResponse.json({
    title: updated.count === 1 ? generatedTitle : conversation.title,
    generated: updated.count === 1,
  });
}
