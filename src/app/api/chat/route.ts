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
import { assembleSystemPrompt } from "@/lib/classification";
import { getSkillSet, buildToolsPayloadForProvider } from "@/lib/skills/registry";
import type { SkillDefinition } from "@/lib/skills/registry";
import {
  retrieveProjectContext,
  shouldUseProjectContext,
} from "@/lib/rag/vector-store";
import { embedQuery } from "@/lib/rag/embedding";
import { cacheExperiments } from "@/lib/cache/experiment-config";
import { reorderMessagesForCache } from "@/lib/cache/prompt-reorder";
import { getProviderApiKey } from "@/lib/data/provider-access";
import { ProviderAccessError } from "@/lib/provider-access";
import { logger } from "@/lib/logger";
import { _internalForTesting as agentLoopInternal } from "@/lib/agent/conversation-loop";

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

  const webSearchActive = body.webSearchActive === true;
  const projectMode = mode || project?.type || "general";

  let systemPrompt: string;
  try {
    systemPrompt = await assembleSystemPrompt({
      webSearchActive,
      projectId: project?.id,
      userId,
      mode: projectMode,
    });
  } catch (err) {
    // Graceful fallback: if UserRole tables aren't migrated yet or any
    // classification infra fails, use the old prompt system.
    logger.error("assembleSystemPrompt failed, falling back", { error: String(err) });
    const { getGlobalPrompt, getModePrompt } = await import("@/lib/ai/prompts");
    systemPrompt = getGlobalPrompt(webSearchActive);
    if (project) {
      systemPrompt = `${systemPrompt}\n\n${getModePrompt(projectMode)}`;
    }
  }

  if (project && hiddenPrompt) {
    systemPrompt = `${systemPrompt}\n\n【快捷任务指令】\n${hiddenPrompt}`;
  }

  let retrievedContext = "";
  let contextNotice: string | null = null;

  if (project) {

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
      logger.debug("project context retrieval", { debug: retrieval.debug });
    }
  }

  // 仅检查用户显式选中的文件是否需要视觉模型。
  // RAG 检索返回的是纯文本 chunk，永远不包含图片数据，
  // 其来源文档的图片元数据与当前请求无关，不应触发 MiniMax 锁定。
  const visionCheckIds = [...new Set(uniqueFileIds)];
  const contextFilesWithMetadata = visionCheckIds.length > 0
    ? await prisma.fileAsset.findMany({
        where: {
          id: { in: visionCheckIds },
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
  const activeSkills: SkillDefinition[] = [];
  try {
    if (modelRoute.provider === "minimax") {
      streamResult = await streamMiniMaxChat(apiKey, {
        messages: filterThinkingForMiniMax(routedMessages),
        attachments: attachments.filter((attachment) => !isTextAttachment(attachment)),
        thinking: thinkingEnabled,
      });
    } else {
      // Build skills: always include project file skills in project mode,
      // plus web_search if the user has it enabled.
      const skillSet = getSkillSet(projectMode);

      if (webSearchActive) {
        activeSkills.push(...skillSet);
      } else {
        activeSkills.push(...skillSet.filter((s) => s.type === "client"));
      }

      const toolsPayload = buildToolsPayloadForProvider(
        activeSkills,
        modelRoute.provider
      );

      streamResult = await streamChat(apiKey, {
        model,
        messages,
        thinking: thinkingEnabled
          ? { type: "enabled" }
          : { type: "disabled" },
        reasoning_effort: reasoningEffort,
        ...(toolsPayload ? { tools: toolsPayload } : {}),
      });
    }
  } catch (err) {
    if (err instanceof DeepSeekError) {
      // 4xx (400/401/402/422/429) 是请求侧错误,直接透传给前端,便于定位;
      // 5xx 或 0 (网络层) 才包成 502 表示上游不可用。
      const status = err.status >= 400 && err.status < 500 ? err.status : 502;
      return NextResponse.json(
        { error: err.message, deepseekStatus: err.status },
        { status }
      );
    }
    if (err instanceof MiniMaxChatError) {
      const status = err.status >= 400 && err.status < 500 ? err.status : 502;
      return NextResponse.json(
        { error: err.message, minimaxStatus: err.status },
        { status }
      );
    }
    return NextResponse.json(
      { error: "无法连接模型服务，请稍后重试" },
      { status: 502 }
    );
  }

  // 11.5 Tool call execution loop (max 2 rounds, DeepSeek only)
  const agentEvents: string[] = [];
  const agentDecoder = new TextDecoder();
  if (modelRoute.provider === "deepseek" && "getToolCalls" in streamResult) {
    const MAX_TOOL_ROUNDS = 2;
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const toolCalls = (streamResult as unknown as { getToolCalls: () => Array<{ id: string; name: string; input: Record<string, unknown> }> }).getToolCalls();
      const clientToolCalls = toolCalls.filter((tc) => {
        const skill = activeSkills?.find((s) => s.name === tc.name);
        return skill && skill.type === "client";
      });

      if (clientToolCalls.length === 0) break;

      const agentTap = new agentLoopInternal.EventTap((chunk) => {
        agentEvents.push(agentDecoder.decode(chunk, { stream: false }));
      });

      // Execute client-side tools
      const toolResults: Array<{ toolUseId: string; content: string }> = [];
      for (const tc of clientToolCalls) {
        const autoRun = await agentLoopInternal.runAutoTool(
          {
            userId,
            conversationId: conversation.id,
            projectId: project?.id,
            skillId: undefined,
            apiKey,
            model,
            thinkingEnabled,
            reasoningEffort,
            activeTools: [],
            initialMessages: messages,
            signal: new AbortController().signal,
          },
          { id: tc.id, name: tc.name, input: tc.input },
          agentTap
        );
        if (autoRun.status === "succeeded" && autoRun.summary) {
          toolResults.push({ toolUseId: tc.id, content: JSON.stringify(autoRun.summary) });
        } else if (autoRun.error && autoRun.error !== "approval_pending") {
          toolResults.push({
            toolUseId: tc.id,
            content: `工具执行失败: ${autoRun.error}`,
          });
        } else {
          // 等待审批：MVP 暂不阻塞流；用占位字符串让模型继续
          toolResults.push({
            toolUseId: tc.id,
            content: "等待用户审批中；当前跳过此步。",
          });
        }
      }

      // Build follow-up messages with tool results
      const assistantContent = clientToolCalls.map((tc) => ({
        type: "tool_use" as const,
        id: tc.id,
        name: tc.name,
        input: tc.input,
      }));

      const userContent = toolResults.map((tr) => ({
        type: "tool_result" as const,
        tool_use_id: tr.toolUseId,
        content: tr.content,
      }));

      const followUpMessages: DeepSeekMessage[] = [
        ...messages,
        { role: "assistant", content: JSON.stringify(assistantContent) },
        { role: "user", content: JSON.stringify(userContent) },
      ];

      try {
        streamResult = await streamChat(apiKey, {
          model,
          messages: followUpMessages,
          thinking: thinkingEnabled
            ? { type: "enabled" }
            : { type: "disabled" },
          reasoning_effort: reasoningEffort,
        });
      } catch (err) {
        logger.error("Tool execution follow-up failed", { error: String(err) });
        break;
      }
    }
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
    modelRoute.provider,
    streamResult.getUsage
  ).catch((err) => {
    logger.error("保存助手消息失败", { error: String(err) });
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

  // 15. 把 agent events 拼到 SSE 头部，前端用 `event: agent` 解析
  let responseStream: ReadableStream<Uint8Array> = clientStream;
  if (agentEvents.length > 0) {
    const encoder = new TextEncoder();
    const prefix = encoder.encode(agentEvents.join(""));
    responseStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(prefix);
        const reader = clientStream.getReader();
        const pump = () => {
          reader.read().then(({ done, value }) => {
            if (done) {
              controller.close();
              return;
            }
            if (value) controller.enqueue(value);
            pump();
          }).catch((err) => {
            logger.error("SSE pump error", { error: String(err) });
            controller.close();
          });
        };
        pump();
      },
    });
  }

  // 16. 返回 SSE 流
  return new Response(responseStream as unknown as BodyInit, {
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

export async function accumulateAndSave(
  stream: ReadableStream<Uint8Array>,
  conversationId: string,
  messageId: string,
  provider: "deepseek" | "minimax",
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
        provider,
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
