import { randomUUID } from "node:crypto";
import {
  DeepSeekError,
  DeepSeekMessage,
} from "@/lib/deepseek";
import { MiniMaxChatError } from "@/lib/chat/minimax-chat";
import { createProviderAdapter } from "@/lib/agent/adapters";
import { PiAiProviderError } from "@/lib/agent/adapters/pi-ai-adapter";
import { BailianQwenError } from "@/lib/agent/adapters/bailian-qwen-adapter";
import type { ProviderRound, ProviderToolProtocol } from "@/lib/agent/provider-adapter";
import {
  isTextAttachment,
  routeModel,
  type ServerFileAttachment,
} from "@/lib/chat/router";
import { assembleSystemPrompt } from "@/lib/classification";
import { ensureDiscovery } from "@/lib/skills/registry";
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
import {
  runAgentLoop,
  type AgentLoopResult,
} from "@/lib/agent/conversation-loop";
import { createPrismaToolRunner } from "@/lib/agent/tools/tool-runner";
import { PrismaToolExecutionAdapter } from "@/lib/agent/persistence/prisma-tool-execution-adapter";
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
import { prefetchProjectMaterialForQuickTask } from "@/lib/rag/project-material-prefetch";
import { skillRegistry } from "@/lib/agent/skill-registry";
import { toolRegistry } from "@/lib/agent/tool-registry";
import { sanitizeModelText } from "@/lib/agent/tool-call-parser";
import { recordAuditEvent } from "@/lib/agent/audit-log";
import type { AgentSource } from "@/lib/agent/sources";
import type { AgentEvent, ToolMetadata } from "@/lib/agent/types";
import { resolveAgentRuntimeMode } from "@/lib/agent/runtime-mode";
import {
  ContextAssemblyError,
  PrismaContextAssembler,
} from "@/lib/agent/context/context-assembler";
import { PrismaConversationAdapter } from "@/lib/agent/persistence/prisma-conversation-adapter";
import type { ConversationPersistence } from "@/lib/agent/persistence/conversation-persistence";
import { runWebSearch } from "@/lib/tools/web/search-engine";
import type {
  AgentCompletion,
  AgentRun,
  AgentRunInput,
  AgentRuntime,
  AgentUsage,
} from "@/lib/agent/contracts";
import type { AgentRuntimeEvent } from "@/lib/agent/runtime-events";
import { compareRuntimeDecisions } from "@/lib/agent/observability/runtime-shadow";
import { buildInitialAgentPlan, finalizeAgentPlan } from "@/lib/agent/plan";
import { AgentRunMetricsCollector } from "@/lib/agent/observability/agent-run-metrics";
import {
  createTextProviderRound,
  normalizeProviderEventStream,
  type ProviderStreamEvent,
} from "@/lib/agent/providers/provider-event-stream";
import "@/lib/tools/registry";

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

function getServerTimeZone() {
  return process.env.LUMENLAB_TIME_ZONE || process.env.TZ || "Asia/Shanghai";
}

function formatCurrentTimeContext(now = new Date()) {
  const timeZone = getServerTimeZone();
  const localTime = new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    dateStyle: "full",
    timeStyle: "medium",
    hour12: false,
  }).format(now);

  return [
    "# 当前时间上下文",
    "",
    `当前服务器时间：${localTime}`,
    `时区：${timeZone}`,
    `UTC 时间：${now.toISOString()}`,
    "",
    "当用户提到今天、现在、最新、近期、昨天、明天等相对时间时，必须基于以上时间理解和检索。",
    "这段上下文由系统自动提供，只用于时间判断和联网搜索，不要在回答中提到隐藏提示词或系统内部流程。",
  ].join("\n");
}

function prependCurrentTimeContext(prompt: string, now = new Date()) {
  return `${formatCurrentTimeContext(now)}\n\n# 用户问题\n\n${prompt}`;
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

function buildAllowedTools(input: {
  projectId?: string | null;
  webSearchActive: boolean;
  activeSkillId?: string | null;
  planningEnabled?: boolean;
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

  if (input.planningEnabled) add("plan.update");

  return [...allowed.values()];
}

function adapterFallbackEvent(
  protocol: ProviderToolProtocol
): "native_tools" | "xml_dsml_fallback" | "none" {
  if (protocol === "native+xml_dsml") return "xml_dsml_fallback";
  if (protocol === "native") return "native_tools";
  return "none";
}

function providerForRequestedModel(
  model: AgentRunInput["model"]["requestedModel"]
): "deepseek" | "minimax" | "bailian" {
  if (model === "minimax-m3") return "minimax";
  if (model === "qwen3.7-plus") return "bailian";
  return "deepseek";
}

export class AgentRuntimeError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "AgentRuntimeError";
  }
}

export async function runAgentRuntime(input: AgentRunInput): Promise<AgentRun> {
  const runStartedAt = Date.now();
  const conversationPersistence = new PrismaConversationAdapter();
  const userId = input.user.id;
  const conversationId = input.conversation.id;
  const projectId = input.conversation.projectId;
  const message = input.prompt.message;
  const hiddenPrompt = input.prompt.hiddenPrompt;
  const attachments = input.prompt.attachments;
  const model = input.model.requestedModel;
  const runId = randomUUID();
  const runMetrics = new AgentRunMetricsCollector({
    runId,
    model,
    provider: providerForRequestedModel(model),
    startedAt: runStartedAt,
  });
  let runMetricRecorded = false;
  const recordRunMetricOnce = async (
    status: AgentCompletion["status"] | "failed",
    resolvedConversationId = conversationId
  ) => {
    if (runMetricRecorded) return;
    runMetricRecorded = true;
    await recordAuditEvent({
      userId,
      conversationId: resolvedConversationId,
      eventType: "agent_run_finished",
      severity: status === "completed" ? "info" : status === "failed" ? "error" : "warn",
      payload: { ...runMetrics.finish(status) },
    });
  };
  const thinkingEnabled = input.model.thinkingEnabled;
  const reasoningEffort = input.model.reasoningEffort;
  const selectedFileIds = input.capabilities.selectedFileIds;
  const mode = input.capabilities.mode;
  const manualSkillId = input.capabilities.manualSkillId;
  const skillOff = input.capabilities.skillOff;
  const isQuickTask = input.capabilities.isQuickTask;
  const materialScope = input.capabilities.materialScope;
  try {
  const attachmentText = await textAttachmentContext(attachments);
  let effectivePrompt = [
    hiddenPrompt || message,
    attachmentText,
  ].filter(Boolean).join("\n\n");

  // 4. 校验项目与文件上下文
  let resourceContext;
  try {
    resourceContext = await new PrismaContextAssembler().assemble({
      userId,
      ...(projectId ? { projectId } : {}),
      selectedFileIds,
    });
  } catch (error) {
    if (error instanceof ContextAssemblyError) {
      throw new AgentRuntimeError(error.status, error.message);
    }
    throw error;
  }
  const {
    project,
    selectedFiles,
    selectedFileIds: uniqueFileIds,
    requiresVisionModel,
  } = resourceContext;

  // 确保 Skill discovery 已完成；catalog / instructions / activate_skill enum 都依赖 skillRegistry。
  await ensureDiscovery();

  const agentRuntimeMode = resolveAgentRuntimeMode();
  const agentOrchestratorEnabled = agentRuntimeMode === "new";
  const manualWebSearchActive = effectiveWebSearchActive(
    model,
    input.capabilities.webSearchActive
  );
  let webSearchActive = manualWebSearchActive;
  const projectMode = mode || project?.type || "general";

  let systemPrompt = "";

  let retrievedContext = "";
  let contextNotice: string | null = null;
  let legacySources: AgentSource[] = [];
  let projectRetrievalAttempted = false;
  let quickTaskMaterialContext = "";
  let quickTaskMaterialSources: AgentSource[] = [];
  const projectMaterialQuickTask = Boolean(
    project && isQuickTask && materialScope !== "none"
  );

  if (projectMaterialQuickTask && project) {
    const prefetch = await prefetchProjectMaterialForQuickTask({
      userId,
      projectId: project.id,
      selectedFileIds: uniqueFileIds,
      prompt: effectivePrompt,
    });
    if (prefetch.status !== "ok") {
      throw new AgentRuntimeError(400, prefetch.message);
    }
    quickTaskMaterialContext = prefetch.context;
    quickTaskMaterialSources = prefetch.sources.map((source) => ({
      type: "project_file" as const,
      title: source.title,
      fileId: source.fileAssetId,
      snippet: source.snippet,
      metadata: {
        mode: "quick-task-prefetch",
        selectedOnly: prefetch.selectedOnly,
        readableFileCount: prefetch.readableFileCount,
        totalCandidateFileCount: prefetch.totalCandidateFileCount,
      },
    }));
    logger.debug("quick task material prefetch", {
      projectId: project.id,
      selectedOnly: prefetch.selectedOnly,
      readableFileCount: prefetch.readableFileCount,
      totalCandidateFileCount: prefetch.totalCandidateFileCount,
    });
  }

  if (project && !agentOrchestratorEnabled && !projectMaterialQuickTask) {

    if (shouldUseProjectContext(effectivePrompt, uniqueFileIds, isQuickTask)) {
      projectRetrievalAttempted = true;
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

  const preflightRoute = !conversationId
    ? routeModel(null, attachments, { requiresVisionModel, requestedModel: model })
    : null;
  let preflightApiKey: string | null = null;
  if (preflightRoute) {
    try {
      preflightApiKey = await getProviderApiKey(userId, preflightRoute.provider);
    } catch (error) {
      throw new AgentRuntimeError(
        403,
        error instanceof ProviderAccessError
          ? error.message
          : "服务密钥暂时不可用"
      );
    }
  }

  // 6. 获取或创建对话
  let conversation;
  if (conversationId) {
    conversation = await conversationPersistence.findOwnedConversation({
      conversationId,
      userId,
    });
    if (!conversation) {
      throw new AgentRuntimeError(404, "对话不存在");
    }
    if (projectId && conversation.projectId !== projectId) {
      throw new AgentRuntimeError(400, "该对话不属于当前项目");
    }
    if (
      conversation.model !== model ||
      conversation.thinkingEnabled !== thinkingEnabled
    ) {
      conversation = await conversationPersistence.updateModelPreferences({
        conversationId: conversation.id,
        model,
        thinkingEnabled,
      });
    }
  } else {
    conversation = await conversationPersistence.createConversation({
      userId,
      // The visible title is generated asynchronously after the stream begins.
      // Never expose a full user prompt as a navigation label in the meantime.
      title: "新对话",
      model,
      thinkingEnabled,
      ...(project?.id ? { projectId: project.id } : {}),
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
    skillDisabled: projectMaterialQuickTask
      ? true
      : conversation.skillDisabled || false,
    isQuickTask: isQuickTask || false,
  });
  webSearchActive =
    manualWebSearchActive ||
    (agentOrchestratorEnabled && skillRoute.webAccessRecommended);
  const planningEnabled =
    agentOrchestratorEnabled &&
    (skillRoute.profile === "research" || skillRoute.profile === "workflow");
  if (webSearchActive) {
    effectivePrompt = prependCurrentTimeContext(effectivePrompt);
  }

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
  if (planningEnabled) {
    systemPrompt = `${systemPrompt}\n\n【任务计划】系统已发布本次任务的简短公开计划。仅在阶段发生变化时调用 plan.update，更新 1–6 条用户可见步骤；不要写入分析过程、隐藏提示或敏感内容，也不要附加 reason。步骤标题只能使用：明确研究问题与边界、明确交付目标与约束、收集可核验的资料、比较证据并形成结论、核验引用与不确定性、准备所需资料与操作、执行并记录关键结果、检查结果与下一步。`;
  }
  if (agentOrchestratorEnabled) {
    systemPrompt = `${systemPrompt}\n\n【工具恢复】若工具结果包含 recoveryOfExecutionId，且你决定自动恢复该失败操作，请在下一次工具调用附带同名 recoveryOfExecutionId 字段。该字段只用于关联失败与恢复，不会传给工具处理器。`;
  }

  const modelRoute = routeModel(conversation, attachments, {
    requiresVisionModel,
    requestedModel: model,
  });
  runMetrics.setRoute({ model, provider: modelRoute.provider });

  // Build the active tool allowlist from the real tool registry.
  const activeTools = projectMaterialQuickTask
    ? buildAllowedTools({
        projectId: undefined,
        webSearchActive,
        activeSkillId: null,
        planningEnabled: false,
      }).filter((tool) => tool.toolId === "web.search" || tool.toolId === "web.fetch")
    : buildAllowedTools({
        projectId: project?.id,
        webSearchActive,
        activeSkillId: skillRoute.activeSkillId,
        planningEnabled,
      });

  if (agentRuntimeMode === "shadow") {
    const candidateWebSearchActive =
      manualWebSearchActive || skillRoute.webAccessRecommended;
    const candidatePlan = buildPlannedToolCalls({
      prompt: effectivePrompt,
      profile: skillRoute.profile,
      projectId: project?.id,
      selectedFileIds: uniqueFileIds,
      webAccessRecommended: candidateWebSearchActive,
    });
    logger.info("agent runtime shadow comparison", {
      runtimeMode: agentRuntimeMode,
      ...compareRuntimeDecisions({
        legacy: {
          skillId: conversation.activeSkillId,
          webSearchActive,
          plannedToolIds: [],
        },
        candidate: {
          skillId: skillRoute.activeSkillId,
          webSearchActive: candidateWebSearchActive,
          plannedToolIds: candidatePlan.map((call) => call.name),
        },
      }),
    });
  }

  const shouldCompressDeepSeekHistory =
    modelRoute.provider === "minimax" && conversation.modelLock !== "minimax";
  if (modelRoute.shouldLock) {
    conversation = await conversationPersistence.lockModel({
      conversationId: conversation.id,
      provider: modelRoute.provider === "bailian" ? "qwen" : "minimax",
    });
  }

  const agentEvents: AgentEvent[] = [];
  let publicPlan: ReturnType<typeof buildInitialAgentPlan> = null;
  const emitAgentEvent = (event: AgentEvent) => {
    agentEvents.push(event);
    if (event.type === "plan_updated") publicPlan = event.plan;
    runMetrics.observeAgentEvent(event);
  };
  let retrievalExplanationEmitted = false;
  const explainRetrieval = (sourceCount: number, sourceLabel = "项目资料") => {
    if (retrievalExplanationEmitted) return;
    retrievalExplanationEmitted = true;
    emitAgentEvent({
      type: "capability_explained",
      capability: "retrieval",
      title: "已检索相关资料",
      reason: `为了让回答可核验，我检索了与当前问题相关的${sourceLabel}。`,
      detail:
        sourceCount > 0
          ? `已纳入 ${sourceCount} 条可引用来源。`
          : "没有找到可核验的来源；回答会明确这一限制。",
    });
  };
  const toolRunner = createPrismaToolRunner();
  const sessionApprovals = await new PrismaToolExecutionAdapter()
    .loadSessionApprovals({
      userId,
      conversationId: conversation.id,
    });
  let manualWebContext = "";
  let manualWebSources: AgentSource[] = [];

  if (agentOrchestratorEnabled) {
    const initialPlan = buildInitialAgentPlan({
      profile: skillRoute.profile,
      prompt: effectivePrompt,
    });
    if (initialPlan) {
      publicPlan = initialPlan;
      emitAgentEvent({ type: "plan_updated", plan: initialPlan, source: "runtime" });
    }
    if (skillRoute.suggestions.length > 0) {
      emitAgentEvent({
        type: "skill_suggested",
        suggestions: skillRoute.suggestions,
      });
    }
    const skillData = {
      activeSkillId: skillRoute.activeSkillId,
      activeSkillVersion: skillRoute.activeSkillId ? skillRegistry.get(skillRoute.activeSkillId)?.version ?? "1.0.0" : null,
      activeSkillSource: skillRoute.activeSkillId ? skillRoute.source : null,
      activeSkillStatus: skillRoute.activeSkillId ? skillRoute.status : null,
      skillDisabled: skillOff === true ? true : manualSkillId ? false : undefined,
    };

    if (skillRoute.activeSkillId) {
      const skill = skillRegistry.get(skillRoute.activeSkillId);
      const skillVersion = skill?.version ?? "1.0.0";
      conversation = await conversationPersistence.updateSkillState({
        conversationId: conversation.id,
        ...skillData,
      });
      await conversationPersistence.recordSkillActivation({
        conversationId: conversation.id,
        skillId: skillRoute.activeSkillId,
        version: skillVersion,
        source: skillRoute.source,
        statusAtActivation: skillRoute.status,
        confidence: skillRoute.confidence,
        reason: skillRoute.reason,
        missingInfo: skillRoute.missingInfo,
      });
      emitAgentEvent({
        type: "skill_activated",
        skillId: skillRoute.activeSkillId,
        version: skillVersion,
        status: skillRoute.status === "none" ? undefined : skillRoute.status,
        reason: skillRoute.reason,
      });
      emitAgentEvent({
        type: "capability_explained",
        capability: "skill",
        title: "已选择任务能力",
        reason: skillRoute.reason,
        detail: `已启用 ${skill?.displayName ?? skillRoute.activeSkillId}。`,
      });
    } else if (conversation.activeSkillId || skillOff === true) {
      const deactivatedSkillId = conversation.activeSkillId;
      conversation = await conversationPersistence.updateSkillState({
        conversationId: conversation.id,
        ...skillData,
      });
      if (deactivatedSkillId) {
        await conversationPersistence.deactivateSkill({
          conversationId: conversation.id,
          skillId: deactivatedSkillId,
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
      throw new AgentRuntimeError(
        403,
        error instanceof ProviderAccessError
          ? error.message
          : "服务密钥暂时不可用"
      );
    }
  }

  if (modelRoute.provider === "minimax" && manualWebSearchActive) {
    let searchApiKey: string;
    try {
      searchApiKey = await getProviderApiKey(userId, "deepseek");
    } catch (error) {
      throw new AgentRuntimeError(
        403,
        error instanceof ProviderAccessError
          ? error.message
          : "联网搜索服务密钥暂时不可用"
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
      explainRetrieval(manualWebSources.length, "联网资料");
    }
    if (manualWebSources.length === 0) {
      explainRetrieval(0, "联网资料");
    }
  }

  // 7. 获取对话历史
  const history = await conversationPersistence.loadHistory(conversation.id);

  // 9. 保存用户消息
  await conversationPersistence.createUserMessage({
    conversationId: conversation.id,
    content: message,
  });

  let orchestratorToolContext = "";
  const preludeAttemptedCalls: Array<{
    toolId: string;
    arguments: Record<string, unknown>;
  }> = [];
  const preludePendingExecutionIds: string[] = [];
  let orchestratorSources: AgentSource[] = [
    ...quickTaskMaterialSources,
    ...manualWebSources,
  ];
  if (agentOrchestratorEnabled && projectMaterialQuickTask) {
    if (quickTaskMaterialSources.length > 0) {
      emitAgentEvent({
        type: "sources_updated",
        sources: quickTaskMaterialSources,
      });
    }
    explainRetrieval(quickTaskMaterialSources.length);
  }
  if (projectRetrievalAttempted) explainRetrieval(legacySources.length);
  if (agentOrchestratorEnabled && !projectMaterialQuickTask) {
    const plannedCalls = buildPlannedToolCalls({
      prompt: effectivePrompt,
      profile: skillRoute.profile,
      projectId: project?.id,
      selectedFileIds: uniqueFileIds,
      webAccessRecommended: webSearchActive,
    });

    if (plannedCalls.length > 0) {
      const toolRun = await executePlannedToolCalls({
        profile: skillRoute.profile,
        plannedCalls,
        runTool: async (call: PlannedToolCall) => {
          if (input.signal.aborted) {
            return { status: "failed", error: "request_cancelled" };
          }
          const result = await toolRunner.run(
            {
              call: { id: call.id, toolId: call.name, arguments: call.input },
              context: {
                userId,
                conversationId: conversation.id,
                projectId: project?.id,
                selectedFileIds: uniqueFileIds,
                skillId: skillRoute.activeSkillId ?? undefined,
                runId,
                signal: input.signal,
                sessionApprovals,
              },
            },
            emitAgentEvent
          );
          if (result.status === "succeeded") {
            return { status: "succeeded", summary: result.summary };
          }
          if (result.status === "pending_approval") {
            return {
              status: "pending_approval",
              executionId: result.executionId,
            };
          }
          return {
            status: "failed",
            error: result.error,
          };
        },
      });
      preludePendingExecutionIds.push(...toolRun.pendingExecutionIds);
      orchestratorToolContext = toolRun.contextMessage;
      preludeAttemptedCalls.push(
        ...toolRun.results.map((item) => ({
            toolId: item.call.name,
            arguments: item.call.input,
          }))
      );
      orchestratorSources = [...orchestratorSources, ...toolRun.sources];
      if (orchestratorSources.length > 0) {
        emitAgentEvent({
          type: "sources_updated",
          sources: orchestratorSources,
        });
        explainRetrieval(
          orchestratorSources.length,
          orchestratorSources.some((source) => source.type === "project_file")
            ? "项目资料"
            : "联网资料"
        );
      }
      if (plannedCalls.some((call) => call.name === "project_rag.search")) {
        explainRetrieval(
          orchestratorSources.length,
          "项目资料"
        );
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
  const materialContext = quickTaskMaterialContext
    ? `# 项目资料\n\n${quickTaskMaterialContext}`
    : "";
  const toolContext = [materialContext, manualWebContext, orchestratorToolContext]
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
        await conversationPersistence.createContextSummary({
          conversationId: conversation.id,
          content: `【此前对话压缩上下文】\n${compressionResult.summary}\n\n请在后续回答中继承这些事实与约束。`,
          compressedCount: compressionResult.compressedCount,
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
          throw new AgentRuntimeError(
            400,
            "上下文过长，请新建对话或输入 /compact 压缩历史"
          );
        }
      }
    } catch (err) {
      if (err instanceof AgentRuntimeError) throw err;
      logger.error("上下文压缩失败", { error: String(err) });
      if (budgetCheck.status === "overflow") {
        emitAgentEvent({
          type: "context_budget_overflow",
          tokens: budgetCheck.tokens,
          budget: budgetCheck.budget,
          ratio: budgetCheck.ratio,
        });
        throw new AgentRuntimeError(
          400,
          "上下文过长，请新建对话或输入 /compact 压缩历史"
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
  let streamResult: ProviderRound;
  let adapter: ReturnType<typeof createProviderAdapter> | undefined;
  try {
    adapter = createProviderAdapter(modelRoute.provider, apiKey);
    if (preludePendingExecutionIds.length > 0) {
      streamResult = createTextProviderRound(
        routedMessages,
        "等待用户批准工具操作后继续。"
      );
    } else {
      if (agentOrchestratorEnabled) {
        emitAgentEvent({
          type: "model_adapter_selected",
          provider: modelRoute.provider,
          model,
          fallback: adapterFallbackEvent(adapter.toolProtocol(activeTools)),
        });
      }
      streamResult = await adapter.startRound({
        model,
        messages: routedMessages,
        thinkingEnabled,
        reasoningEffort,
        activeTools,
        attachments,
        signal: input.signal,
      });
    }
  } catch (err) {
    throw (
      mapProviderError(err) ??
      new AgentRuntimeError(502, "无法连接模型服务，请稍后重试")
    );
  }

  // 11.5 Runtime-owned provider/tool loop.
  if (!adapter) {
    throw new Error("Provider adapter was not initialized");
  }
  let loopResult: AgentLoopResult;
  if (preludePendingExecutionIds.length > 0) {
    loopResult = {
      status: "awaiting_approval",
      finalRound: streamResult,
      pendingExecutionIds: preludePendingExecutionIds,
      stopReason: "approval_required",
    };
  } else {
    try {
      loopResult = await runAgentLoop({
        provider: adapter,
        initialRound: streamResult,
        model,
        thinkingEnabled,
        reasoningEffort,
        activeTools,
        messages: streamResult.requestMessages,
        context: {
          userId,
          conversationId: conversation.id,
          projectId: project?.id,
          selectedFileIds: uniqueFileIds,
          skillId: skillRoute.activeSkillId ?? undefined,
          runId,
          sessionApprovals,
        },
        signal: input.signal,
        toolRunner,
        emit: emitAgentEvent,
        audit: recordAuditEvent,
        preAttemptedCalls: preludeAttemptedCalls,
      });
    } catch (error) {
      const mapped = mapProviderError(error);
      if (mapped) throw mapped;
      throw error;
    }
  }
  streamResult = loopResult.finalRound;
  if (publicPlan) {
    emitAgentEvent({
      type: "plan_updated",
      plan: finalizeAgentPlan(publicPlan, loopResult.status),
      source: "runtime",
    });
  }
  if (loopResult.stopReason && process.env.AGENT_DEBUG_EVENTS === "1") {
    emitAgentEvent({
      type: "tool_loop_stop_reason",
      reason: loopResult.stopReason,
    });
  }

  const messageSources = orchestratorSources.length > 0 ? orchestratorSources : legacySources;
  const assistantMessage = await conversationPersistence.createAssistantMessage({
    conversationId: conversation.id,
    sources: messageSources,
  });

  const [eventStream, persistenceStream] = streamResult.events.tee();
  const completion = accumulateAndSaveEvents(
    observeProviderEvents(persistenceStream, runMetrics),
    conversation.id,
    assistantMessage.id,
    userId,
    model,
    modelRoute.provider,
    streamResult.getUsage,
    messageSources,
    loopResult.status,
    conversationPersistence
  )
    .then(async (result) => {
      runMetrics.recordUsage(result.usage);
      await recordRunMetricOnce(result.status, conversation.id);
      return result;
    })
    .catch(async (error) => {
      await recordRunMetricOnce("failed", conversation.id);
      throw error;
    });
  void completion.catch((error) => {
    logger.error("保存助手消息失败", { error: String(error) });
  });

  // 14. 首次对话更新标题
  if (!conversationId) {
    conversationPersistence
      .updateTitle({
        conversationId: conversation.id,
        title: message.slice(0, 100).replace(/\n/g, " "),
      })
      .catch(() => {});
  }

  const metadata: AgentRun["metadata"] = {
    conversationId: conversation.id,
    messageId: assistantMessage.id,
    provider: modelRoute.provider,
    model,
    runtimeMode: agentRuntimeMode,
    runtimeVersion: "1",
    toolProtocol: adapter.toolProtocol(activeTools),
  };

  return {
    metadata,
    events: providerEventsToRuntimeEvents(
      agentEvents,
      eventStream,
      metadata,
      preludePendingExecutionIds.length === 0
    ),
    completion,
  };
  } catch (error) {
    await recordRunMetricOnce("failed");
    throw error;
  }
}

export class DefaultAgentRuntime implements AgentRuntime {
  run(input: AgentRunInput): Promise<AgentRun> {
    return runAgentRuntime(input);
  }
}

export const agentRuntime: AgentRuntime = new DefaultAgentRuntime();

function mapProviderError(error: unknown): AgentRuntimeError | null {
  if (error instanceof PiAiProviderError) {
    const status =
      error.status >= 400 && error.status < 500 ? error.status : 502;
    return new AgentRuntimeError(status, error.message, {
      piAiStatus: error.status,
      piAiProvider: error.provider,
    });
  }
  if (error instanceof BailianQwenError) {
    const status =
      error.status >= 400 && error.status < 500 ? error.status : 502;
    return new AgentRuntimeError(status, error.message, {
      bailianStatus: error.status,
    });
  }
  if (error instanceof DeepSeekError) {
    // 4xx are request-side errors; network/5xx failures map to bad gateway.
    const status =
      error.status >= 400 && error.status < 500 ? error.status : 502;
    return new AgentRuntimeError(status, error.message, {
      deepseekStatus: error.status,
    });
  }
  if (error instanceof MiniMaxChatError) {
    const status =
      error.status >= 400 && error.status < 500 ? error.status : 502;
    return new AgentRuntimeError(status, error.message, {
      minimaxStatus: error.status,
    });
  }
  return null;
}

async function* providerEventsToRuntimeEvents(
  operationalEvents: AgentEvent[],
  stream: ReadableStream<ProviderStreamEvent>,
  metadata: AgentRun["metadata"],
  modelStarted: boolean
): AsyncIterable<AgentRuntimeEvent> {
  for (const event of operationalEvents) yield event;
  if (modelStarted) {
    yield {
      type: "model_started",
      provider: metadata.provider,
      model: metadata.model,
    };
  }

  const reader = stream.getReader();
  let completed = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        completed = true;
        break;
      }
      if (value.type === "usage") {
        yield { type: "usage", usage: normalizeUsage(value.usage) };
      } else {
        yield value;
      }
    }
  } finally {
    if (!completed) await reader.cancel("runtime event consumer cancelled").catch(() => {});
    reader.releaseLock();
  }

  yield {
    type: "completed",
    conversationId: metadata.conversationId,
    messageId: metadata.messageId,
  };
}

function observeProviderEvents(
  stream: ReadableStream<ProviderStreamEvent>,
  metrics: AgentRunMetricsCollector
): ReadableStream<ProviderStreamEvent> {
  return new ReadableStream<ProviderStreamEvent>({
    async start(controller) {
      const reader = stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          metrics.observeProviderEvent(value);
          controller.enqueue(value);
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      } finally {
        reader.releaseLock();
      }
    },
    async cancel(reason) {
      await stream.cancel(reason).catch(() => {});
    },
  });
}

function normalizeUsage(usage: {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
}): AgentUsage {
  return {
    promptTokens: usage.prompt_tokens ?? 0,
    completionTokens: usage.completion_tokens ?? 0,
    totalTokens: usage.total_tokens ?? 0,
    promptCacheHitTokens: usage.prompt_cache_hit_tokens,
    promptCacheMissTokens: usage.prompt_cache_miss_tokens,
  };
}

export async function accumulateAndSave(
  stream: ReadableStream<Uint8Array>,
  conversationId: string,
  messageId: string,
  userId: string,
  model: AgentRunInput["model"]["requestedModel"],
  provider: AgentCompletion["provider"],
  getUsage: () => {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
  } | null,
  sources: AgentSource[] = [],
  completionStatus: AgentCompletion["status"] = "completed",
  persistence: ConversationPersistence = new PrismaConversationAdapter()
): Promise<AgentCompletion> {
  return accumulateAndSaveEvents(
    normalizeProviderEventStream(stream),
    conversationId,
    messageId,
    userId,
    model,
    provider,
    getUsage,
    sources,
    completionStatus,
    persistence
  );
}

async function accumulateAndSaveEvents(
  stream: ReadableStream<ProviderStreamEvent>,
  conversationId: string,
  messageId: string,
  userId: string,
  model: AgentRunInput["model"]["requestedModel"],
  provider: AgentCompletion["provider"],
  getUsage: () => {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
  } | null,
  sources: AgentSource[],
  completionStatus: AgentCompletion["status"],
  persistence: ConversationPersistence
): Promise<AgentCompletion> {
  const reader = stream.getReader();
  let fullContent = "";
  let fullReasoning = "";
  let completionUsage: AgentUsage | null = null;
  let streamError: unknown;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      if (value.type === "text_delta") fullContent += value.text;
      if (value.type === "reasoning_delta") fullReasoning += value.text;
    }
  } catch (error) {
    streamError = error;
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
    completionUsage = {
      promptTokens,
      completionTokens,
      totalTokens: usage?.total_tokens ?? promptTokens + completionTokens,
      promptCacheHitTokens: hitTokens,
      promptCacheMissTokens: missTokens,
    };

    await persistence.completeAssistantMessage({
      messageId,
      content: sanitizeModelText(fullContent) || "（模型未输出正文）",
      reasoningContent: sanitizeModelText(fullReasoning) || null,
      tokenCount: usage?.total_tokens ?? null,
      provider,
      cacheHitTokens: hitTokens || null,
      cacheMissTokens: missTokens || null,
      sources,
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
    await persistence.deleteMessage(messageId).catch(() => {});
  }

  await persistence.touchConversation(conversationId).catch(() => {});

  if (streamError) throw streamError;

  return {
    status: completionStatus,
    conversationId,
    messageId,
    provider,
    model,
    usage: completionUsage,
    sources,
  };
}
