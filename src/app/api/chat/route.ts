import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { sendMessageSchema, type SendMessageInput } from "@/lib/validators";
import { streamChat, DeepSeekError, DeepSeekMessage } from "@/lib/deepseek";
import { streamMiniMaxChat, MiniMaxChatError } from "@/lib/chat/minimax-chat";
import { filterThinkingForMiniMax } from "@/lib/chat/history-adapter";
import {
  isTextAttachment,
  routeModel,
  type ServerFileAttachment,
} from "@/lib/chat/router";
import { checkRateLimit, RateLimits } from "@/lib/rate-limit";
import { GLOBAL_SYSTEM_PROMPT, getModePrompt } from "@/lib/ai/prompts";
import {
  retrieveProjectContext,
  shouldUseProjectContext,
} from "@/lib/rag/vector-store";
import { embedQuery } from "@/lib/rag/embedding";
import { cacheExperiments } from "@/lib/cache/experiment-config";
import { reorderMessagesForCache } from "@/lib/cache/prompt-reorder";
import { getProviderApiKey } from "@/lib/data/provider-access";
import { ProviderAccessError } from "@/lib/provider-access";

async function parseRequest(request: NextRequest): Promise<{
  body: SendMessageInput;
  attachments: ServerFileAttachment[];
}> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const messageField = formData.get("message");
    if (typeof messageField !== "string") {
      throw new Error("缺少消息字段");
    }
    const parsed = sendMessageSchema.safeParse(JSON.parse(messageField));
    if (!parsed.success) {
      throw new Error(JSON.stringify(parsed.error.flatten().fieldErrors));
    }
    const attachments: ServerFileAttachment[] = [];
    for (const value of formData.getAll("attachments")) {
      if (!(value instanceof File)) continue;
      attachments.push({
        name: value.name,
        mimeType: value.type || "application/octet-stream",
        size: value.size,
        data: Buffer.from(await value.arrayBuffer()),
      });
    }
    return { body: parsed.data, attachments };
  }

  const raw = await request.json();
  const parsed = sendMessageSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(JSON.stringify(parsed.error.flatten().fieldErrors));
  }
  return { body: parsed.data, attachments: [] };
}

async function textAttachmentContext(attachments: ServerFileAttachment[]) {
  const sections = attachments
    .filter(isTextAttachment)
    .map((attachment) => {
      const content = attachment.data.toString("utf-8");
      return `---\n文件：${attachment.name}\n\n${content}`;
    });
  return sections.join("\n\n");
}

function metadataRequiresVision(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") return false;
  const record = metadata as Record<string, unknown>;
  return record.requiresVisionModel === true ||
    (typeof record.retainedImageCount === "number" && record.retainedImageCount > 0);
}

function summarizeHistoryForMiniMax(
  history: Array<{ role: string; content: string }>
) {
  const lines = history
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-12)
    .map((message) => {
      const role = message.role === "user" ? "用户" : "助手";
      return `${role}: ${message.content.replace(/\s+/g, " ").trim()}`;
    })
    .filter((line) => line.length > 4);

  const summary = lines.join("\n").slice(-12000);
  return summary
    ? `【此前对话压缩上下文】\n${summary}\n\n请在后续回答中继承这些事实与约束。`
    : "";
}

export async function POST(request: NextRequest) {
  // 1. 身份验证
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const userId = session.user.id;

  // 2. 用户级速率限制
  const { allowed } = await checkRateLimit(
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
  let attachments: ServerFileAttachment[] = [];
  try {
    const parsed = await parseRequest(request);
    body = parsed.body;
    attachments = parsed.attachments;
  } catch (error) {
    const message = error instanceof Error ? error.message : "无效的请求格式";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const {
    conversationId,
    message,
    hiddenPrompt,
    model,
    thinkingEnabled,
    reasoningEffort,
    projectId,
    selectedFileIds,
    mode,
  } = body;
  const attachmentText = await textAttachmentContext(attachments);
  const effectivePrompt = [
    hiddenPrompt || message,
    attachmentText,
  ].filter(Boolean).join("\n\n");

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
          status: true,
          processingMetadata: true,
        },
      })
    : [];

  if (selectedFiles.length !== uniqueFileIds.length) {
    return NextResponse.json(
      { error: "部分文件不存在或不属于当前项目" },
      { status: 400 }
    );
  }

  let systemPrompt = GLOBAL_SYSTEM_PROMPT;
  let retrievedContext = "";
  let contextNotice: string | null = null;
  let retrievalUsedFileIds: string[] = [];

  if (project) {
    const projectMode = mode || project.type || "general";
    const modePrompt = getModePrompt(projectMode);
    systemPrompt = `${systemPrompt}\n\n【模式指令】\n${modePrompt}`;
    if (hiddenPrompt) {
      systemPrompt = `${systemPrompt}\n\n【快捷任务指令】\n${hiddenPrompt}`;
    }

    if (shouldUseProjectContext(effectivePrompt, uniqueFileIds)) {
      const retrieval = await retrieveProjectContext({
        userId,
        projectId: project.id,
        selectedFileIds: uniqueFileIds,
        query: effectivePrompt,
        maxChars: 60000,
        loadQueryEmbedding: async () => {
          try {
            const bailianKey = await getProviderApiKey(userId, "bailian");
            return await embedQuery(effectivePrompt, bailianKey);
          } catch {
            return undefined;
          }
        },
      });
      retrievedContext = retrieval.context;
      contextNotice = retrieval.notice;
      retrievalUsedFileIds = retrieval.usedFileIds;
      if (process.env.NODE_ENV !== "production") {
        console.info("[project-context]", retrieval.debug);
      }
    }
  }

  const contextFileIds = [...new Set([...uniqueFileIds, ...retrievalUsedFileIds])];
  const contextFilesWithMetadata = contextFileIds.length > 0
    ? await prisma.fileAsset.findMany({
        where: {
          id: { in: contextFileIds },
          userId,
          ...(projectId ? { projectId } : {}),
        },
        select: {
          id: true,
          processingMetadata: true,
        },
      })
    : [];
  const requiresVisionModel = contextFilesWithMetadata.some((file) =>
    metadataRequiresVision(file.processingMetadata)
  );

  const preflightRoute = !conversationId
    ? routeModel(null, attachments, { requiresVisionModel, requestedModel: model })
    : null;
  let preflightApiKey: string | null = null;
  if (preflightRoute) {
    try {
      preflightApiKey = await getProviderApiKey(userId, preflightRoute.provider);
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof ProviderAccessError
              ? error.message
              : "服务密钥暂时不可用",
        },
        { status: 403 }
      );
    }
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
    if (
      conversation.model !== model ||
      conversation.thinkingEnabled !== thinkingEnabled
    ) {
      conversation = await prisma.conversation.update({
        where: { id: conversation.id },
        data: { model, thinkingEnabled },
      });
    }
  } else {
    const title = message.slice(0, 100).replace(/\n/g, " ");
    conversation = await prisma.conversation.create({
      data: {
        userId,
        title,
        model,
        thinkingEnabled,
        projectId: project?.id || null,
      },
    });
  }

  const modelRoute = routeModel(conversation, attachments, {
    requiresVisionModel,
    requestedModel: model,
  });
  const shouldCompressDeepSeekHistory =
    modelRoute.provider === "minimax" && conversation.modelLock !== "minimax";
  if (modelRoute.shouldLock) {
    conversation = await prisma.conversation.update({
      where: { id: conversation.id },
      data: { modelLock: "minimax" },
    });
  }

  let apiKey = preflightRoute?.provider === modelRoute.provider
    ? preflightApiKey
    : null;
  if (!apiKey) {
    try {
      apiKey = await getProviderApiKey(userId, modelRoute.provider);
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof ProviderAccessError
              ? error.message
              : "服务密钥暂时不可用",
        },
        { status: 403 }
      );
    }
  }

  // 7. 获取对话历史
  const history = await prisma.message.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true },
  });

  // 9. 保存用户消息
  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role: "user",
      content: message,
    },
  });

  // 10. 构建 DeepSeek 消息数组（system prompt 在最前）
  const contextualUserMessage = retrievedContext
    ? `# 项目资料\n\n${retrievedContext}\n\n# 用户问题\n\n${effectivePrompt}`
    : contextNotice
      ? `${effectivePrompt}\n\n[系统提示：${contextNotice}]`
      : effectivePrompt;

  const legacyMessages: DeepSeekMessage[] = [
    { role: "system", content: systemPrompt },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: contextualUserMessage },
  ];
  const experimentalBaseMessages: DeepSeekMessage[] = [
    { role: "system", content: systemPrompt },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    {
      role: "user",
      content: contextNotice
        ? `${effectivePrompt}\n\n[系统提示：${contextNotice}]`
        : effectivePrompt,
    },
  ];
  const messages = cacheExperiments.adaptivePromptOrdering.enabled
    ? reorderMessagesForCache(
        experimentalBaseMessages,
        systemPrompt,
        retrievedContext,
        cacheExperiments.adaptivePromptOrdering
      )
    : legacyMessages;
  const minimaxHistorySummary = shouldCompressDeepSeekHistory
    ? summarizeHistoryForMiniMax(history)
    : "";
  const routedMessages = minimaxHistorySummary
    ? [
        { role: "system", content: systemPrompt } as DeepSeekMessage,
        { role: "user", content: minimaxHistorySummary } as DeepSeekMessage,
        { role: "user", content: contextualUserMessage } as DeepSeekMessage,
      ]
    : messages;

  // 11. 调用模型
  let streamResult;
  try {
    if (modelRoute.provider === "minimax") {
      streamResult = await streamMiniMaxChat(apiKey, {
        messages: filterThinkingForMiniMax(routedMessages),
        attachments: attachments.filter((attachment) => !isTextAttachment(attachment)),
        thinking: thinkingEnabled,
      });
    } else {
      streamResult = await streamChat(apiKey, {
        model,
        messages,
        thinking: thinkingEnabled
          ? { type: "enabled" }
          : { type: "disabled" },
        reasoning_effort: reasoningEffort,
      });
    }
  } catch (err) {
    if (err instanceof DeepSeekError) {
      return NextResponse.json(
        { error: err.message, deepseekStatus: err.status },
        { status: err.status > 0 ? 502 : 500 }
      );
    }
    if (err instanceof MiniMaxChatError) {
      return NextResponse.json(
        { error: err.message, minimaxStatus: err.status },
        { status: err.status > 0 ? 502 : 500 }
      );
    }
    return NextResponse.json(
      { error: "无法连接模型服务，请稍后重试" },
      { status: 502 }
    );
  }

  const assistantMessage = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role: "assistant",
      content: "",
    },
    select: { id: true },
  });

  // 12. Tee 分流
  const [clientStream, serverStream] = streamResult.stream.tee();

  // 13. 异步保存
  accumulateAndSave(
    serverStream,
    conversation.id,
    assistantMessage.id,
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
      "X-Message-Id": assistantMessage.id,
      "X-Model-Provider": modelRoute.provider,
    },
  });
}

async function accumulateAndSave(
  stream: ReadableStream<Uint8Array>,
  conversationId: string,
  messageId: string,
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
    await prisma.message.update({
      where: { id: messageId },
      data: {
        content: fullContent,
        reasoningContent: fullReasoning || null,
        tokenCount: usage?.total_tokens ?? null,
        cacheHitTokens: usage?.prompt_cache_hit_tokens ?? null,
        cacheMissTokens: usage?.prompt_cache_miss_tokens ?? null,
      },
    });
  } else {
    await prisma.message.delete({ where: { id: messageId } }).catch(() => {});
  }

  await prisma.conversation
    .update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    })
    .catch(() => {});
}
