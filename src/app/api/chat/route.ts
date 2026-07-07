import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { sendMessageSchema, type SendMessageInput } from "@/lib/validators";
import {
  DeepSeekError,
  DeepSeekMessage,
  ToolUseBlock,
  DeepSeekContentBlock,
} from "@/lib/deepseek";
import { MiniMaxChatError } from "@/lib/chat/minimax-chat";
import { filterThinkingForMiniMax } from "@/lib/chat/history-adapter";
import { createProviderAdapter } from "@/lib/agent/adapters";
import {
  isTextAttachment,
  routeModel,
  type ServerFileAttachment,
} from "@/lib/chat/router";
import { checkRateLimit, RateLimits } from "@/lib/rate-limit";
import { assembleSystemPrompt } from "@/lib/classification";
import {
  ensureDiscovery,
  DEEPSEEK_WEB_SEARCH_TYPE,
} from "@/lib/skills/registry";
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
import { routeSkill } from "@/lib/agent/skill-router";
import {
  checkContextBudget,
  recordTokenUsage,
} from "@/lib/tokens";
import { compressHistory, buildCompressedMessages } from "@/lib/chat/compression";
import { effectiveWebSearchActive } from "@/lib/chat/model-capabilities";
import {
  buildPlannedToolCalls,
  executePlannedToolCalls,
  type PlannedToolCall,
} from "@/lib/agent/orchestrator";
import { formatAgentEvent } from "@/lib/agent/event-stream";
import { skillRegistry } from "@/lib/agent/skill-registry";
import { toolRegistry } from "@/lib/agent/tool-registry";
import { parseToolCalls, sanitizeModelText } from "@/lib/agent/tool-call-parser";
import { recordAuditEvent } from "@/lib/agent/audit-log";
import type { AgentSource } from "@/lib/agent/sources";
import type { ToolMetadata } from "@/lib/agent/types";
import { runWebSearch } from "@/lib/tools/web/search-engine";
import type { Prisma } from "@/generated/prisma/client";
import { validateUploadBatch } from "@/lib/files/file-upload-policy";
import "@/lib/tools/registry";

function isAgentOrchestratorEnabled() {
  if (process.env.AGENT_ORCHESTRATOR_ENABLED === "0") return false;
  if (process.env.AGENT_ORCHESTRATOR_ENABLED === "1") return true;
  return process.env.NODE_ENV !== "production";
}

/**
 * 判断是否应该服务端预注入 skill instructions。
 * - 用户手动选择：总是预注入
 * - Router 高置信度（>= 0.85）：预注入，避免首轮 tool 往返延迟
 * - 低置信度：不预注入，让模型自己调用 activate_skill
 */
function shouldPreInject(route: { source: string; confidence: number }): boolean {
  if (route.source === "manual") return true;
  if (route.source === "rule" && route.confidence >= 0.85) return true;
  return false;
}

function formatManualWebContext(input: {
  query: string;
  summary: string;
  sources: Array<{ url: string; title?: string }>;
}) {
  const sourceLines = input.sources.length
    ? input.sources
        .map((source, index) => {
          const title = source.title || source.url;
          return `${index + 1}. ${title}\n   ${source.url}`;
        })
        .join("\n")
    : "无可用来源 URL";

  return [
    "# 联网搜索结果",
    "",
    `查询: ${input.query}`,
    "",
    input.summary || "未获得可用联网摘要。",
    "",
    "## 来源",
    sourceLines,
    "",
    "请基于以上联网搜索结果回答。不要声称自己没有联网能力；如果联网结果不足，请明确说明不足之处。",
  ].join("\n");
}

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

    const batchCheck = validateUploadBatch(attachments);
    if (!batchCheck.ok) {
      throw new Error(batchCheck.error);
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

function replaySSEChunks(chunks: Uint8Array[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

async function bufferSSEStream(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      chunks.push(value.slice());
    }
  } finally {
    reader.releaseLock();
  }

  return {
    stream: replaySSEChunks(chunks),
    chunks,
  };
}

/**
 * 包装 runAutoTool，捕获未注册工具等同步抛错，避免单个工具失败导致整个 SSE 流 500。
 */
async function safeRunAutoTool(
  inputs: Parameters<typeof agentLoopInternal.runAutoTool>[0],
  toolUse: ToolUseBlock,
  eventTap: InstanceType<typeof agentLoopInternal.EventTap>
): ReturnType<typeof agentLoopInternal.runAutoTool> {
  try {
    return await agentLoopInternal.runAutoTool(inputs, toolUse, eventTap);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    eventTap.emit({
      type: "tool_failed",
      executionId: toolUse.id,
      errorCode: "RUN_ERROR",
      error: message,
    });
    return { status: "failed", error: message };
  }
}

interface MergedToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

function buildDeepSeekAllowedTools(input: {
  projectId?: string | null;
  webSearchActive: boolean;
  activeSkillId?: string | null;
}): ToolMetadata[] {
  const allowed = new Map<string, ToolMetadata>();
  const add = (toolId: string) => {
    const tool = toolRegistry.get(toolId);
    if (tool) allowed.set(toolId, tool);
  };

  // Always expose skill activation.
  add("skill.activate");

  if (input.projectId) {
    for (const tool of toolRegistry.list()) {
      if (
        tool.toolId.startsWith("project_") ||
        tool.toolId.startsWith("artifact.") ||
        tool.toolId.startsWith("reference.") ||
        tool.toolId.startsWith("arxiv.")
      ) {
        add(tool.toolId);
      }
    }
  }

  if (input.webSearchActive) {
    add("web.search");
    add("web.fetch");
  }

  const skill = input.activeSkillId
    ? skillRegistry.get(input.activeSkillId)
    : undefined;
  if (skill?.allowedTools?.length) {
    const baseIds = new Set(allowed.keys());
    for (const id of baseIds) {
      if (id === "skill.activate") continue;
      if (!skill.allowedTools.includes(id)) {
        // Keep web tools if the user explicitly enabled web search.
        if (
          input.webSearchActive &&
          (id === "web.search" || id === "web.fetch")
        ) {
          continue;
        }
        allowed.delete(id);
      }
    }
    for (const toolId of skill.allowedTools) {
      add(toolId);
    }
  }

  return [...allowed.values()];
}

function toAnthropicToolPayload(
  tools: ToolMetadata[]
): Array<{
  type: string;
  name: string;
  description?: string;
  input_schema?: Record<string, unknown>;
}> {
  // DeepSeek 的 Anthropic 兼容层目前只接受内置的 web_search 工具；
  // 其它工具通过 XML/DSML fallback 在 route 层解析执行，不在这里发送。
  return tools
    .filter((tool) => tool.toolId === "web.search")
    .map((tool) => ({
      type: DEEPSEEK_WEB_SEARCH_TYPE,
      name: "web_search",
      description: tool.description,
      input_schema: tool.inputSchema,
    }));
}

function formatToolInstructions(tools: ToolMetadata[]): string {
  const instructionTools = tools.filter((tool) => tool.toolId !== "web.search");
  if (instructionTools.length === 0) return "";

  const lines = [
    "你可以调用以下工具获取信息或执行操作。需要调用时，请严格使用如下 XML 格式（可包含多个 invoke）：",
    "",
    "<tool_calls>",
    '  <invoke name="tool.id">',
    '    <parameter name="key">value</parameter>',
    "  </invoke>",
    "</tool_calls>",
    "",
    "可用工具：",
  ];

  for (const tool of instructionTools) {
    const schema = tool.inputSchema as {
      properties?: Record<string, { description?: string }>;
      required?: string[];
    };
    const required = schema.required?.length
      ? `（必填：${schema.required.join(", ")}）`
      : "";
    lines.push(`- ${tool.toolId}: ${tool.description}${required}`);
  }

  return lines.join("\n");
}

function mergeToolCalls(
  nativeCalls: ToolUseBlock[],
  parsedCalls: Array<{ name: string; input: Record<string, unknown> }>
): MergedToolCall[] {
  const result: MergedToolCall[] = [];
  const seen = new Set<string>();
  const key = (name: string, input: Record<string, unknown>) =>
    `${name}:${JSON.stringify(input, Object.keys(input).sort())}`;

  for (const tc of nativeCalls) {
    const k = key(tc.name, tc.input);
    if (seen.has(k)) continue;
    seen.add(k);
    result.push({ id: tc.id, name: tc.name, input: tc.input });
  }

  for (let i = 0; i < parsedCalls.length; i++) {
    const tc = parsedCalls[i];
    const k = key(tc.name, tc.input);
    if (seen.has(k)) continue;
    seen.add(k);
    result.push({ id: `parsed-${tc.name}-${i}`, name: tc.name, input: tc.input });
  }

  return result;
}

function filterToolCallsByWhitelist(
  calls: MergedToolCall[],
  allowedNames: Set<string>
): { executable: MergedToolCall[]; blocked: MergedToolCall[] } {
  const executable: MergedToolCall[] = [];
  const blocked: MergedToolCall[] = [];
  for (const tc of calls) {
    if (allowedNames.has(tc.name)) {
      executable.push(tc);
    } else {
      blocked.push(tc);
    }
  }
  return { executable, blocked };
}

function buildToolFollowUpMessages(
  messages: DeepSeekMessage[],
  toolCalls: MergedToolCall[],
  toolResults: Array<{ toolUseId: string; content: string }>,
  rawContent: string
): DeepSeekMessage[] {
  const assistantContent: DeepSeekContentBlock[] = [];
  const sanitizedText = sanitizeModelText(rawContent);
  if (sanitizedText) {
    assistantContent.push({ type: "text", text: sanitizedText });
  }
  for (const tc of toolCalls) {
    assistantContent.push({
      type: "tool_use",
      id: tc.id,
      name: tc.name,
      input: tc.input,
    });
  }

  const userContent: DeepSeekContentBlock[] = toolResults.map((tr) => ({
    type: "tool_result",
    tool_use_id: tr.toolUseId,
    content: tr.content,
  }));

  return [
    ...messages,
    { role: "assistant", content: assistantContent },
    { role: "user", content: userContent },
  ];
}

export async function POST(request: NextRequest) {
  try {
    return await handlePost(request);
  } catch (err) {
    logger.error("chat route failed", {
      error: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "聊天请求失败" },
      { status: 500 }
    );
  }
}

async function handlePost(request: NextRequest) {
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
    manualSkillId,
    skillOff,
    isQuickTask,
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

  // 确保 Skill discovery 已完成；catalog / instructions / activate_skill enum 都依赖 skillRegistry。
  await ensureDiscovery();

  const agentOrchestratorEnabled = isAgentOrchestratorEnabled();
  const manualWebSearchActive = effectiveWebSearchActive(
    model,
    body.webSearchActive
  );
  let webSearchActive = manualWebSearchActive;
  const projectMode = mode || project?.type || "general";

  let systemPrompt = "";

  let retrievedContext = "";
  let contextNotice: string | null = null;
  let legacySources: AgentSource[] = [];

  if (project && !agentOrchestratorEnabled) {

    if (shouldUseProjectContext(effectivePrompt, uniqueFileIds, isQuickTask)) {
      const retrieval = await retrieveProjectContext({
        userId,
        projectId: project.id,
        selectedFileIds: uniqueFileIds,
        query: effectivePrompt,
        maxChars: 60000,
        forceProjectContext: isQuickTask,
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
      legacySources = retrieval.sources.map((source) => ({
        type: "project_file" as const,
        title: source.title,
        fileId: source.fileAssetId,
        snippet: source.snippet,
      }));
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

  const skillRoute = routeSkill({
    message,
    hiddenPrompt,
    projectId: project?.id,
    selectedFileIds: uniqueFileIds,
    selectedFiles: selectedFiles.map((file) => ({
      id: file.id,
      name: file.originalName,
      mimeType: file.mimeType,
    })),
    webSearchActive: manualWebSearchActive,
    manualSkillId: manualSkillId || null,
    skillOff: skillOff || false,
    skillDisabled: conversation.skillDisabled || false,
    isQuickTask: isQuickTask || false,
  });
  webSearchActive =
    manualWebSearchActive ||
    (agentOrchestratorEnabled && skillRoute.webAccessRecommended);

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

  // Skill pre-injection（渐进披露优化）:
  // Router 高置信度或用户手动选择时，在首轮调用前直接注入完整 skill instructions，
  // 不走 activate_skill tool 往返，保证首轮质量。
  if (skillRoute.activeSkillId && shouldPreInject(skillRoute)) {
    const activeSkill = skillRegistry.get(skillRoute.activeSkillId);
    if (activeSkill?.instructions) {
      systemPrompt = `${systemPrompt}\n\n<skill_content name="${activeSkill.skillId}">\n${activeSkill.instructions}\n</skill_content>`;
    }
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

  const agentEvents: string[] = [];
  const agentDecoder = new TextDecoder();
  const emitAgentEvent = (event: Parameters<typeof formatAgentEvent>[0]) => {
    agentEvents.push(formatAgentEvent(event));
  };
  let manualWebContext = "";
  let manualWebSources: AgentSource[] = [];

  if (agentOrchestratorEnabled) {
    emitAgentEvent({
      type: "model_adapter_selected",
      provider: modelRoute.provider,
      model,
      fallback: modelRoute.provider === "minimax" ? "prefetch_tools" : "native_tools",
    });
    if (skillRoute.suggestions.length > 0) {
      emitAgentEvent({
        type: "skill_suggested",
        suggestions: skillRoute.suggestions,
      });
    }
    const skillData: Prisma.ConversationUpdateInput = {
      activeSkillId: skillRoute.activeSkillId,
      activeSkillVersion: skillRoute.activeSkillId ? skillRegistry.get(skillRoute.activeSkillId)?.version ?? "1.0.0" : null,
      activeSkillSource: skillRoute.activeSkillId ? skillRoute.source : null,
      activeSkillStatus: skillRoute.activeSkillId ? skillRoute.status : null,
      skillDisabled: skillOff === true ? true : manualSkillId ? false : undefined,
    };

    if (skillRoute.activeSkillId) {
      const skill = skillRegistry.get(skillRoute.activeSkillId);
      const skillVersion = skill?.version ?? "1.0.0";
      conversation = await prisma.conversation.update({
        where: { id: conversation.id },
        data: skillData,
      });
      await prisma.conversationSkill.create({
        data: {
          conversationId: conversation.id,
          skillId: skillRoute.activeSkillId,
          version: skillVersion,
          source: skillRoute.source,
          statusAtActivation: skillRoute.status,
          confidence: skillRoute.confidence,
          reason: skillRoute.reason,
          missingInfo: skillRoute.missingInfo as Prisma.InputJsonValue,
        },
      });
      emitAgentEvent({
        type: "skill_activated",
        skillId: skillRoute.activeSkillId,
        version: skillVersion,
        status: skillRoute.status === "none" ? undefined : skillRoute.status,
        reason: skillRoute.reason,
      });
    } else if (conversation.activeSkillId || skillOff === true) {
      const deactivatedSkillId = conversation.activeSkillId;
      conversation = await prisma.conversation.update({
        where: { id: conversation.id },
        data: skillData,
      });
      if (deactivatedSkillId) {
        await prisma.conversationSkill.updateMany({
          where: {
            conversationId: conversation.id,
            skillId: deactivatedSkillId,
            deactivatedAt: null,
          },
          data: { deactivatedAt: new Date() },
        });
        emitAgentEvent({ type: "skill_deactivated", skillId: deactivatedSkillId });
      }
    }
  }

  if (webSearchActive) {
    emitAgentEvent({
      type: "web_access_enabled",
      mode: manualWebSearchActive ? "manual" : "auto",
      reason: manualWebSearchActive ? "用户手动开启联网搜索" : skillRoute.reason,
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

  if (modelRoute.provider === "minimax" && manualWebSearchActive) {
    let searchApiKey: string;
    try {
      searchApiKey = await getProviderApiKey(userId, "deepseek");
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof ProviderAccessError
              ? error.message
              : "联网搜索服务密钥暂时不可用",
        },
        { status: 403 }
      );
    }

    const webResult = await runWebSearch(effectivePrompt, searchApiKey);
    manualWebContext = formatManualWebContext(webResult);
    manualWebSources = webResult.sources.map((source) => ({
      type: "web",
      title: source.title || source.url,
      url: source.url,
      snippet: webResult.summary.slice(0, 240),
      metadata: {
        query: webResult.query,
        mode: "manual-prefetch",
        provider: "deepseek-web-search",
      },
    }));
    if (manualWebSources.length > 0) {
      emitAgentEvent({
        type: "sources_updated",
        sources: manualWebSources,
      });
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

  let orchestratorToolContext = "";
  let orchestratorSources: AgentSource[] = manualWebSources;
  if (agentOrchestratorEnabled) {
    const plannedCalls = buildPlannedToolCalls({
      prompt: effectivePrompt,
      profile: skillRoute.profile,
      projectId: project?.id,
      selectedFileIds: uniqueFileIds,
      webAccessRecommended: webSearchActive,
    });

    if (plannedCalls.length > 0) {
      const agentTap = new agentLoopInternal.EventTap((chunk) => {
        agentEvents.push(agentDecoder.decode(chunk, { stream: false }));
      });
      const toolRun = await executePlannedToolCalls({
        profile: skillRoute.profile,
        plannedCalls,
        runTool: async (call: PlannedToolCall) => {
          const result = await safeRunAutoTool(
            {
              userId,
              conversationId: conversation.id,
              projectId: project?.id,
              skillId: skillRoute.activeSkillId ?? undefined,
              apiKey,
              model,
              thinkingEnabled,
              reasoningEffort,
              activeTools: [],
              initialMessages: [],
              signal: new AbortController().signal,
            },
            { id: call.id, name: call.name, input: call.input },
            agentTap
          );
          if (result.status === "succeeded" && result.summary) {
            return { status: "succeeded", summary: result.summary };
          }
          return {
            status: "failed",
            error: result.error ?? "工具执行失败",
          };
        },
      });
      orchestratorToolContext = toolRun.contextMessage;
      orchestratorSources = [...orchestratorSources, ...toolRun.sources];
      if (orchestratorSources.length > 0) {
        emitAgentEvent({
          type: "sources_updated",
          sources: orchestratorSources,
        });
      }
      if (toolRun.stopReason && process.env.AGENT_DEBUG_EVENTS === "1") {
        emitAgentEvent({
          type: "tool_loop_stop_reason",
          reason: toolRun.stopReason,
        });
      }
    }
  }

  // 10. 构建 DeepSeek 消息数组（system prompt 在最前）
  const toolContext = [manualWebContext, orchestratorToolContext]
    .filter(Boolean)
    .join("\n\n");
  const userPromptWithTools = toolContext
    ? `${toolContext}\n\n# 用户问题\n\n${effectivePrompt}`
    : effectivePrompt;
  const contextualUserMessage = retrievedContext
    ? `# 项目资料\n\n${retrievedContext}\n\n# 用户问题\n\n${effectivePrompt}`
    : contextNotice
      ? `${userPromptWithTools}\n\n[系统提示：${contextNotice}]`
      : userPromptWithTools;

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
        ? `${userPromptWithTools}\n\n[系统提示：${contextNotice}]`
        : userPromptWithTools,
    },
  ];
  type StringMessage = { role: string; content: string };
  const stringMessages =
    (cacheExperiments.adaptivePromptOrdering.enabled
      ? reorderMessagesForCache(
          experimentalBaseMessages as unknown as StringMessage[],
          systemPrompt,
          retrievedContext,
          cacheExperiments.adaptivePromptOrdering
        )
      : legacyMessages) as unknown as StringMessage[];

  let messages: DeepSeekMessage[] = stringMessages as DeepSeekMessage[];

  // 上下文窗口预算检查与自动压缩
  const budgetCheck = checkContextBudget(messages as unknown as StringMessage[]);
  if (budgetCheck.status === "warn") {
    emitAgentEvent({
      type: "context_budget_warning",
      tokens: budgetCheck.tokens,
      budget: budgetCheck.budget,
      ratio: budgetCheck.ratio,
    });
  }

  if (budgetCheck.status === "compress" || budgetCheck.status === "overflow") {
    try {
      const compressionApiKey = await getProviderApiKey(userId, "deepseek");
      const compressionResult = await compressHistory({
        apiKey: compressionApiKey,
        messages: messages as unknown as StringMessage[],
      });
      if (compressionResult) {
        await prisma.message.create({
          data: {
            conversationId: conversation.id,
            role: "system",
            content: `【此前对话压缩上下文】\n${compressionResult.summary}\n\n请在后续回答中继承这些事实与约束。`,
            subtype: "context-summary",
            metadata: {
              compressedCount: compressionResult.compressedCount,
            } as Prisma.InputJsonValue,
          },
        });
        messages = buildCompressedMessages(
          messages as unknown as StringMessage[],
          compressionResult.summary
        ) as DeepSeekMessage[];
        const reCheck = checkContextBudget(messages as unknown as StringMessage[]);
        emitAgentEvent({
          type: "context_budget_compressed",
          tokens: reCheck.tokens,
          budget: reCheck.budget,
          ratio: reCheck.ratio,
          compressedCount: compressionResult.compressedCount,
        });
        if (reCheck.status === "overflow") {
          emitAgentEvent({
            type: "context_budget_overflow",
            tokens: reCheck.tokens,
            budget: reCheck.budget,
            ratio: reCheck.ratio,
          });
          return NextResponse.json(
            { error: "上下文过长，请新建对话或输入 /compact 压缩历史" },
            { status: 400 }
          );
        }
      }
    } catch (err) {
      logger.error("上下文压缩失败", { error: String(err) });
      if (budgetCheck.status === "overflow") {
        emitAgentEvent({
          type: "context_budget_overflow",
          tokens: budgetCheck.tokens,
          budget: budgetCheck.budget,
          ratio: budgetCheck.ratio,
        });
        return NextResponse.json(
          { error: "上下文过长，请新建对话或输入 /compact 压缩历史" },
          { status: 400 }
        );
      }
    }
  }

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
  let adapter: ReturnType<typeof createProviderAdapter> | undefined;
  let activeTools: ToolMetadata[] = [];
  let toolsPayload:
    | ReturnType<typeof toAnthropicToolPayload>
    | undefined;
  try {
    adapter = createProviderAdapter(modelRoute.provider, apiKey);

    // Build the active tool allowlist from the real tool registry.
    activeTools = buildDeepSeekAllowedTools({
      projectId: project?.id,
      webSearchActive,
      activeSkillId: skillRoute.activeSkillId,
    });
    toolsPayload =
      modelRoute.provider === "deepseek" && activeTools.length > 0
        ? toAnthropicToolPayload(activeTools)
        : undefined;

    const adapterMessages =
      modelRoute.provider === "minimax"
        ? filterThinkingForMiniMax(routedMessages)
        : messages;

    streamResult = await adapter.stream({
      model,
      messages: adapterMessages,
      thinkingEnabled,
      reasoningEffort,
      ...(toolsPayload ? { tools: toolsPayload } : {}),
      ...(modelRoute.provider === "minimax"
        ? { attachments: attachments.filter((attachment) => !isTextAttachment(attachment)) }
        : {}),
    });
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

  // DeepSeek 只能下发内置 web_search，其它工具靠 XML/DSML fallback。
  // 把允许的工具清单注入 system prompt，让模型知道可以调用哪些工具以及如何输出。
  if (modelRoute.provider === "deepseek" && activeTools.length > 0) {
    const toolInstructions = formatToolInstructions(activeTools);
    if (toolInstructions) {
      systemPrompt = `${systemPrompt}\n\n${toolInstructions}`;
    }
  }

  // 11.5 DeepSeek streaming tool loop (max 2 rounds).
  // Each round is fully buffered server-side so that pseudo tool markup never
  // leaks to the client. Only whitelisted, structurally valid tool calls are
  // executed; malformed markup is sanitized away before replay/persistence.
  if (modelRoute.provider === "deepseek" && activeTools.length > 0) {
    const MAX_TOOL_ROUNDS = 2;
    const allowedToolNames = new Set(activeTools.map((t) => t.toolId));
    let executedInLastRound = false;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const buffered = await bufferSSEStream(streamResult.stream);
      streamResult = { ...streamResult, stream: buffered.stream };

      const rawContent = streamResult.getRawContent?.() ?? "";
      const rawReasoning = streamResult.getRawReasoning?.() ?? "";
      const nativeCalls = streamResult.getToolCalls();
      const parsedCalls = parseToolCalls(`${rawReasoning}\n${rawContent}`);
      const merged = mergeToolCalls(nativeCalls, parsedCalls);
      const { executable, blocked } = filterToolCallsByWhitelist(
        merged,
        allowedToolNames
      );

      for (let i = 0; i < blocked.length; i++) {
        const tc = blocked[i];
        const executionId = tc.id.startsWith("parsed-")
          ? `blocked-${tc.name}-${i}`
          : tc.id;
        emitAgentEvent({
          type: "tool_blocked",
          executionId,
          reasonCode: "NOT_IN_ALLOWLIST",
          reason: `Tool ${tc.name} 不在当前允许列表中`,
        });
        recordAuditEvent({
          userId,
          conversationId: conversation.id,
          toolId: tc.name,
          eventType: "tool_blocked",
          severity: "warn",
          payload: {
            reason: "not_in_allowlist",
            input: tc.input,
            source: tc.id.startsWith("parsed-") ? "parsed_fallback" : "native",
          },
        }).catch(() => {});
      }

      if (executable.length === 0) {
        break;
      }

      const agentTap = new agentLoopInternal.EventTap((chunk) => {
        agentEvents.push(agentDecoder.decode(chunk, { stream: false }));
      });

      const toolResults: Array<{ toolUseId: string; content: string }> = [];
      for (const tc of executable) {
        const autoRun = await safeRunAutoTool(
          {
            userId,
            conversationId: conversation.id,
            projectId: project?.id,
            skillId: skillRoute.activeSkillId ?? undefined,
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
          toolResults.push({
            toolUseId: tc.id,
            content: JSON.stringify(autoRun.summary),
          });
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

      messages = buildToolFollowUpMessages(
        messages,
        executable,
        toolResults,
        rawContent
      );

      try {
        if (!adapter) break;

        if (round === MAX_TOOL_ROUNDS - 1) {
          // Round limit reached: force a final no-tool completion.
          streamResult = await adapter.stream({
            model,
            messages,
            thinkingEnabled,
            reasoningEffort,
          });
          executedInLastRound = true;
          break;
        }

        streamResult = await adapter.stream({
          model,
          messages,
          thinkingEnabled,
          reasoningEffort,
          tools: toolsPayload,
        });
      } catch (err) {
        logger.error("Tool execution follow-up failed", { error: String(err) });
        break;
      }
    }

    if (executedInLastRound) {
      // The final no-tool stream may still contain pseudo tool markup from a
      // hallucinating model; deepseek.ts sanitizes content/reasoning, so we
      // simply stream it without executing further tools.
      void streamResult.getToolCalls;
    }
  }

  const messageSources = orchestratorSources.length > 0 ? orchestratorSources : legacySources;
  const assistantMessage = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role: "assistant",
      content: "",
      sources: messageSources as unknown as Prisma.InputJsonValue,
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
    userId,
    model,
    modelRoute.provider,
    streamResult.getUsage,
    messageSources
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
      "X-Agent-Orchestrator": agentOrchestratorEnabled ? "enabled" : "disabled",
    },
  });
}

export async function accumulateAndSave(
  stream: ReadableStream<Uint8Array>,
  conversationId: string,
  messageId: string,
  userId: string,
  model: string,
  provider: "deepseek" | "minimax",
  getUsage: () => {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
  } | null,
  sources: AgentSource[] = []
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

  if (fullContent || fullReasoning) {
    const usage = getUsage();
    const promptTokens = usage?.prompt_tokens ?? 0;
    const completionTokens = usage?.completion_tokens ?? 0;
    const hitTokens = usage?.prompt_cache_hit_tokens ?? 0;
    const missTokens = Math.max(
      usage?.prompt_cache_miss_tokens ?? 0,
      promptTokens - hitTokens,
      0
    );

    await prisma.message.update({
      where: { id: messageId },
      data: {
        content: sanitizeModelText(fullContent) || "（模型未输出正文）",
        reasoningContent: sanitizeModelText(fullReasoning) || null,
        tokenCount: usage?.total_tokens ?? null,
        provider,
        cacheHitTokens: hitTokens || null,
        cacheMissTokens: missTokens || null,
        sources: sources as unknown as Prisma.InputJsonValue,
      },
    });

    await recordTokenUsage({
      userId,
      conversationId,
      messageId,
      model,
      provider,
      inputCacheHitTokens: hitTokens,
      inputCacheMissTokens: missTokens,
      outputTokens: completionTokens,
      totalTokens: usage?.total_tokens ?? promptTokens + completionTokens,
    }).catch((err) => {
      logger.error("Token 用量记录失败", { error: String(err) });
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
