import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { sendMessageSchema, type SendMessageInput } from "@/lib/validators";
import { streamChat, DeepSeekError, DeepSeekMessage } from "@/lib/deepseek";
import { checkRateLimit, RateLimits } from "@/lib/rate-limit";
import { GLOBAL_SYSTEM_PROMPT, getModePrompt } from "@/lib/ai/prompts";

/** Maximum context chars from files to inject */
const MAX_CONTEXT_CHARS = 20000;

export async function POST(request: NextRequest) {
  // 1. 身份验证
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const userId = session.user.id;

  // 2. 用户级速率限制
  const { allowed } = checkRateLimit(
    `chat:${userId}`,
    RateLimits.CHAT.max,
    RateLimits.CHAT.window
  );
  if (!allowed) {
    return NextResponse.json(
      { error: "请求太频繁，请稍后重试" },
      { status: 429 }
    );
  }

  // 3. 解析并验证请求体
  let body: SendMessageInput;
  try {
    const raw = await request.json();
    const parsed = sendMessageSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    body = parsed.data;
  } catch {
    return NextResponse.json({ error: "无效的 JSON 格式" }, { status: 400 });
  }

  const {
    conversationId,
    message,
    model,
    thinkingEnabled,
    reasoningEffort,
    projectId,
    selectedFileIds,
    mode,
  } = body;

  // 4. 校验项目与文件上下文
  let project = null;
  if (projectId) {
    project = await prisma.project.findFirst({
      where: { id: projectId, userId },
    });
    if (!project) {
      return NextResponse.json(
        { error: "项目不存在或无访问权限" },
        { status: 404 }
      );
    }
  }

  if (selectedFileIds?.length && !projectId) {
    return NextResponse.json(
      { error: "选择文件时必须提供项目 ID" },
      { status: 400 }
    );
  }

  const uniqueFileIds = [...new Set(selectedFileIds || [])];
  const selectedFiles = projectId && uniqueFileIds.length > 0
    ? await prisma.fileAsset.findMany({
        where: {
          id: { in: uniqueFileIds },
          userId,
          projectId,
        },
        select: {
          id: true,
          originalName: true,
          mimeType: true,
          textContent: true,
          status: true,
        },
      })
    : [];

  if (selectedFiles.length !== uniqueFileIds.length) {
    return NextResponse.json(
      { error: "部分文件不存在或不属于当前项目" },
      { status: 400 }
    );
  }

  // 5. 获取并解密 API Key
  const apiKeyRecord = await prisma.apiKey.findUnique({
    where: { userId },
  });
  if (!apiKeyRecord) {
    return NextResponse.json(
      { error: "尚未配置 API Key，请在设置中添加" },
      { status: 400 }
    );
  }

  let apiKey: string;
  try {
    apiKey = decrypt(apiKeyRecord.encryptedKey);
  } catch {
    return NextResponse.json(
      { error: "API Key 解密失败，请重新添加" },
      { status: 500 }
    );
  }

  // 6. 获取或创建对话
  let conversation;
  if (conversationId) {
    conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, userId },
    });
    if (!conversation) {
      return NextResponse.json(
        { error: "对话不存在" },
        { status: 404 }
      );
    }
    if (projectId && conversation.projectId !== projectId) {
      return NextResponse.json(
        { error: "该对话不属于当前项目" },
        { status: 400 }
      );
    }
  } else {
    const title = message.slice(0, 100).replace(/\n/g, " ");
    conversation = await prisma.conversation.create({
      data: {
        userId,
        title,
        model,
        projectId: project?.id || null,
      },
    });
  }

  // 7. 获取对话历史
  const history = await prisma.message.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true },
  });

  // 8. 构建系统提示词（合并全局 + 项目上下文）
  let systemPrompt = GLOBAL_SYSTEM_PROMPT;

  if (project) {
    const projectMode = mode || project.type || "general";
    const modePrompt = getModePrompt(projectMode);

    const parts: string[] = [
      "【项目上下文】",
      `项目名称：${project.name}`,
      `项目类型：${projectMode}`,
    ];
    if (project.description) {
      parts.push(`项目描述：${project.description}`);
    }

    if (selectedFiles.length > 0) {
      parts.push("\n用户选择的资料文件：");
      let totalChars = 0;
      let truncated = false;

      for (const file of selectedFiles) {
        const header = `\n文件：${file.originalName}\n类型：${file.mimeType}`;
        const content = file.textContent?.trim();

        if (!content) {
          parts.push(`${header}\n状态：文件已保存，但当前版本未解析出文本内容。`);
          continue;
        }

        const remaining = MAX_CONTEXT_CHARS - totalChars;
        if (remaining <= 0) {
          truncated = true;
          break;
        }

        const excerptLength = Math.min(3000, remaining);
        const excerpt = content.slice(0, excerptLength);
        parts.push(`${header}\n内容：\n${excerpt}`);
        totalChars += excerpt.length;

        if (excerpt.length < content.length) {
          truncated = true;
        }
      }

      if (truncated) {
        parts.push(
          `\n[注意：以下资料为截断内容，已达到 ${MAX_CONTEXT_CHARS} 字符上下文上限。]`
        );
      }
    }

    const contextStr = parts.join("\n");
    systemPrompt = `${systemPrompt}\n\n${contextStr}\n\n【模式指令】\n${modePrompt}`;
  }

  // 9. 保存用户消息
  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role: "user",
      content: message,
    },
  });

  // 10. 构建 DeepSeek 消息数组（system prompt 在最前）
  const messages: DeepSeekMessage[] = [
    { role: "system", content: systemPrompt },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: message },
  ];

  // 11. 调用 DeepSeek
  let streamResult;
  try {
    streamResult = await streamChat(apiKey, {
      model,
      messages,
      thinking: thinkingEnabled
        ? { type: "enabled" }
        : { type: "disabled" },
      reasoning_effort: reasoningEffort,
    });
  } catch (err) {
    if (err instanceof DeepSeekError) {
      return NextResponse.json(
        { error: err.message, deepseekStatus: err.status },
        { status: err.status > 0 ? 502 : 500 }
      );
    }
    return NextResponse.json(
      { error: "无法连接 DeepSeek API，请稍后重试" },
      { status: 502 }
    );
  }

  // 12. Tee 分流
  const [clientStream, serverStream] = streamResult.stream.tee();

  // 13. 异步保存
  accumulateAndSave(
    serverStream,
    conversation.id,
    streamResult.getUsage
  ).catch((err) => {
    console.error("保存助手消息失败:", err);
  });

  // 14. 首次对话更新标题
  if (!conversationId) {
    prisma.conversation
      .update({
        where: { id: conversation.id },
        data: { title: message.slice(0, 100).replace(/\n/g, " ") },
      })
      .catch(() => {});
  }

  // 15. 返回 SSE 流
  return new Response(clientStream as unknown as BodyInit, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Conversation-Id": conversation.id,
    },
  });
}

async function accumulateAndSave(
  stream: ReadableStream<Uint8Array>,
  conversationId: string,
  getUsage: () => {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
  } | null
) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullContent = "";
  let fullReasoning = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;
        const data = trimmed.slice(6);
        if (data === "[DONE]") continue;

        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta;
          if (delta?.content) fullContent += delta.content;
          if (delta?.reasoning_content)
            fullReasoning += delta.reasoning_content;
        } catch {
          // 跳过异常 chunk
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (fullContent) {
    const usage = getUsage();
    await prisma.message.create({
      data: {
        conversationId,
        role: "assistant",
        content: fullContent,
        reasoningContent: fullReasoning || null,
        tokenCount: usage?.total_tokens ?? null,
        cacheHitTokens: usage?.prompt_cache_hit_tokens ?? null,
        cacheMissTokens: usage?.prompt_cache_miss_tokens ?? null,
      },
    });
  }

  await prisma.conversation
    .update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    })
    .catch(() => {});
}
