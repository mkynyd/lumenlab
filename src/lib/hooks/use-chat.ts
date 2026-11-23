"use client";

import { chatModelForPreference, chatModelLabel, DEFAULT_CHAT_MODELS } from "@/lib/chat/model-catalog";
import { useState, useCallback, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  readSSEStream,
  SSEExecutionError,
  type UsageInfo,
} from "@/lib/sse-client";
import {
  buildChatRequestBody,
} from "@/lib/chat-request";
import { ChatUIStream } from "@/lib/chat/intelligent-ui/client-state";
import type { UIEvent } from "@/lib/chat/intelligent-ui/events";
import type { FileAttachment } from "@/lib/chat/router";
import type { UISurface } from "@/lib/chat/intelligent-ui/catalog";
import type { ChatAttachmentDto } from "@/lib/chat/message-attachments";
import { attachmentKindFromMimeType } from "@/lib/files/attachment-kind";
import type { ProjectType } from "@/components/chat/quick-task-bar";
import { queryKeys } from "@/lib/query-keys";
import type { ArtifactDownload } from "@/lib/artifacts/download";
import type { AgentSource } from "@/lib/agent/sources";
import { CHAT_ATTACHMENT_EVENTS_HEADER } from "@/lib/agent/event-stream";
import type { AgentPlan } from "@/lib/agent/plan";
import {
  completeAssistantProcess,
  createAssistantProcessTrace,
  reduceAssistantProcess,
  type AssistantProcessTrace,
} from "@/lib/agent/assistant-process";

export interface AgentSessionState {
  plan?: AgentPlan;
  activeSkill?: {
    skillId: string;
    version: string;
    status?: "active" | "awaiting_context";
    reason?: string;
  };
  suggestions: Array<{ skillId: string; label: string; reason: string }>;
  webAccess?: { mode: "auto" | "manual"; reason: string };
  modelAdapter?: {
    provider: "deepseek" | "minimax" | "bailian";
    model: string;
    fallback: "native_tools" | "xml_dsml_fallback" | "json_action" | "prefetch_tools" | "none";
  };
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  reasoningContent?: string | null;
  tokenCount?: number | null;
  cacheHitTokens?: number | null;
  cacheMissTokens?: number | null;
  sources?: AgentSource[] | null;
  isStreaming?: boolean;
  streamingSource?: "foreground" | "background";
  streamingStartedAt?: number;
  /** 流式期间正在执行的工具 ID（如 web.search），用于状态行展示 */
  activeToolId?: string | null;
  /** 本轮已完成（completed/failed 终态）的工具调用数，流式结束时定格 */
  toolsUsed?: number;
  /** Persisted, replayable public process state for this assistant response. */
  process?: AssistantProcessTrace;
  artifactDownloads?: ArtifactDownload[];
  backgroundExecutionId?: string;
  intelligentUI?: UISurface;
  intelligentUIStreaming?: boolean;
  /**
   * 任务 08：附件。上传期间是本地乐观 DTO（图片/视频为 blob 预览，
   * status: "uploading"），发送成功后替换为服务端持久化附件的同源鉴权 URL。
   */
  attachments?: ChatAttachmentDto[];
}

export interface SendMessageInput {
  /** Called once after the server accepts the request, before model streaming. */
  onAccepted?: () => void;
  content: string;
  hiddenPrompt?: string;
  attachments?: FileAttachment[];
  webSearchActive?: boolean;
  manualSkillId?: string;
  skillOff?: boolean;
  isQuickTask?: boolean;
  materialScope?: "project-corpus" | "none";
}

interface UseChatOptions {
  initialMessages?: ChatMessage[];
  initialConversationId?: string;
  model?: string;
  thinkingEnabled?: boolean;
  reasoningEffort?: "high" | "max";
  modelLoading?: boolean;
  projectId?: string;
  selectedFileIds?: string[];
  mode?: ProjectType;
}

async function fetchConversationMessages(id: string, signal: AbortSignal) {
  const response = await fetch(`/api/conversations/${encodeURIComponent(id)}`, { signal });
  if (!response.ok) return undefined;
  const { conversation } = await response.json() as { conversation: { messages: ChatMessage[] } };
  return conversation.messages;
}

type ReasoningEffort = NonNullable<UseChatOptions["reasoningEffort"]>;

function hasStreamingMessage(messages: ChatMessage[]) {
  return messages.some((message) => message.isStreaming);
}

export async function readChatError(response: Response) {
  const fallback = `Request failed (${response.status})`;
  const htmlFallback = `聊天服务暂时无法连接，请稍后重试（${response.status}）`;
  if (response.headers.get("content-type")?.includes("text/html")) return htmlFallback;
  const text = await response.text().catch(() => "");
  if (!text.trim()) return fallback;
  try {
    const data = JSON.parse(text) as { error?: unknown; reason?: unknown };
    if (typeof data.error === "string" && data.error.trim()) return data.error;
    return typeof data.reason === "string" && data.reason.trim()
      ? data.reason
      : fallback;
  } catch {
    if (text.trimStart().startsWith("<")) return htmlFallback;
    return text.slice(0, 500) || fallback;
  }
}

export function useChat(options: UseChatOptions = {}) {
  const queryClient = useQueryClient();
  const [intelligentUIStream] = useState(() => new ChatUIStream());
  const [messages, setMessages] = useState<ChatMessage[]>(
    options.initialMessages || []
  );
  const [isStreaming, setIsStreaming] = useState(() => hasStreamingMessage(options.initialMessages ?? []));
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | undefined>(
    options.initialConversationId
  );
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [contextBudget, setContextBudget] = useState<{
    status: "warn" | "compress" | "overflow";
    tokens: number;
    ratio: number;
  } | null>(null);
  const [model, setModel] = useState(() => chatModelForPreference(options.model));
  const catalog = useQuery({
    queryKey: queryKeys.chatModels,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/chat/models", { cache: "no-store", signal });
      if (!response.ok) throw new Error(`model catalog ${response.status}`);
      const data = await response.json() as { models?: unknown; unavailableReasons?: Record<string, string> };
      if (!Array.isArray(data.models) || !data.models.every((id) => typeof id === "string")) {
        throw new Error("invalid model catalog");
      }
      return { models: data.models as string[], unavailableReasons: data.unavailableReasons ?? {} };
    },
  });
  // Core model choices can render immediately. The chat POST still checks the
  // authenticated user's effective provider access before accepting a message.
  const availableModels: readonly string[] = catalog.data?.models ?? DEFAULT_CHAT_MODELS;
  const modelBlockedReason = options.modelLoading
    ? "正在加载项目模型设置，请稍候"
    : availableModels.includes(model)
      ? undefined
      : catalog.isPending
        ? "正在检查所选模型，请稍候"
        : catalog.data?.unavailableReasons[model] ?? `${chatModelLabel(model)} 当前不可用，请选择其他可用模型`;
  const [thinkingEnabled, setThinkingEnabledState] = useState(true);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(
    options.reasoningEffort ?? "max"
  );
  const [agentSession, setAgentSession] = useState<AgentSessionState>({
    suggestions: [],
  });
  const abortRef = useRef<AbortController | null>(null);
  /** 当前流式对应的 durable 执行 ID，用于停止时通知服务端真正取消 */
  const agentExecutionIdRef = useRef<string | null>(null);
  const conversationIdRef = useRef<string | undefined>(
    options.initialConversationId
  );
  const streamSessionRef = useRef(0);
  /** 任务 08.4：上传期间的本地预览 URL，随预览退出或组件卸载回收。 */
  const previewUrlsRef = useRef<Set<string>>(new Set());

  const releasePreviewUrls = useCallback(() => {
    for (const url of previewUrlsRef.current) URL.revokeObjectURL(url);
    previewUrlsRef.current.clear();
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      releasePreviewUrls();
    };
  }, [releasePreviewUrls]);

  const setThinkingEnabled = useCallback(() => {
    setThinkingEnabledState(true);
  }, []);

  useEffect(() => {
    if (conversationId || messages.length > 0) return;
    const nextModel = options.projectId ? options.model : undefined;
    const nextReasoningEffort = options.reasoningEffort;
    queueMicrotask(() => {
      if (nextModel) setModel(chatModelForPreference(nextModel));
      if (nextReasoningEffort) {
        setReasoningEffort(nextReasoningEffort);
      }
      setThinkingEnabledState(true);
    });
  }, [conversationId, messages.length, options.projectId, options.model, options.reasoningEffort]);

  const performSend = useCallback(
    async (input: SendMessageInput) => {
      if (modelBlockedReason) { setError(modelBlockedReason); return false; }
      const attachments = input.attachments || [];
      const content = input.content.trim() || (attachments.length > 0 ? "请阅读附件。" : "");
      if (!content.trim() && attachments.length === 0) return;
      const clientRunKey = crypto.randomUUID();

      // Abort any still-attached foreground stream before sending a new message.
      abortRef.current?.abort();
      // durable 模式:先取消上一个仍在运行的服务端执行并等待其落终态,
      // 否则服务端"每对话单执行"护栏会拒绝本次发送(409)。
      const previousExecutionId = agentExecutionIdRef.current;
      if (previousExecutionId) {
        agentExecutionIdRef.current = null;
        await fetch(
          `/api/agent/executions/${encodeURIComponent(previousExecutionId)}/cancel`,
          { method: "POST", signal: AbortSignal.timeout(3_000) }
        ).catch(() => {});
      }
      setAgentSession({ suggestions: [] });
      const streamSession = streamSessionRef.current + 1;
      streamSessionRef.current = streamSession;

      setError(null);
      setIsStreaming(true);

      // 任务 08.4：全部附件都建乐观 DTO 进入消息——图片/视频用本地 blob 预览，
      // 文件没有本地可预览 URL（url/thumbnailUrl 为空串，渲染端按 kind 走卡片
      // 分支，不读 url）；发送成功后统一替换为服务端持久化附件。
      const previewUrls: string[] = [];
      const optimisticAttachments: ChatAttachmentDto[] = attachments.map(
        (attachment) => {
          const kind = attachmentKindFromMimeType(attachment.mimeType);
          const url =
            kind === "file" ? "" : URL.createObjectURL(attachment.data);
          if (url) previewUrls.push(url);
          return {
            id: attachment.id,
            kind,
            name: attachment.name,
            mimeType: attachment.mimeType,
            size: attachment.size,
            width: null,
            height: null,
            status: "uploading",
            url,
            thumbnailUrl: url,
          };
        }
      );
      for (const url of previewUrls) previewUrlsRef.current.add(url);

      const userMessage: ChatMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: content.trim(),
        ...(optimisticAttachments.length > 0
          ? { attachments: optimisticAttachments }
          : {}),
      };
      let streamingId = `assistant-${Date.now()}`;
      const streamingStartedAt = Date.now();
      const releaseSendPreviews = () => {
        for (const url of previewUrls) {
          if (previewUrlsRef.current.delete(url)) URL.revokeObjectURL(url);
        }
      };
      let receivedAttachments = false;
      const updatePersistedAttachments = (persisted: ChatAttachmentDto[]) => {
        if (persisted.length === 0) return;
        receivedAttachments = true;
        setMessages((prev) =>
          prev.map((message) =>
            message.id === userMessage.id ? { ...message, attachments: persisted } : message
          )
        );
        releaseSendPreviews();
      };

      // 本轮工具调用跟踪：executionId → toolId、进行中的执行集合、已完成的数量
      const toolIdByExecution = new Map<string, string>();
      const activeExecutions = new Set<string>();
      let toolsFinished = 0;
      const syncActiveTool = () => {
        let activeToolId: string | null = null;
        for (const executionId of activeExecutions) {
          const toolId = toolIdByExecution.get(executionId);
          if (toolId) {
            activeToolId = toolId;
            break;
          }
        }
        setMessages((prev) =>
          prev.map((m) => (m.id === streamingId ? { ...m, activeToolId } : m))
        );
      };

      setMessages((prev) => [
        ...prev.map((m) =>
          m.isStreaming
            ? {
                ...m,
                isStreaming: false,
                streamingSource: undefined,
                streamingStartedAt: undefined,
              }
            : m
        ),
        userMessage,
        {
          id: streamingId,
          role: "assistant",
          content: "",
          reasoningContent: null,
          isStreaming: true,
          streamingSource: "foreground",
          streamingStartedAt,
          process: createAssistantProcessTrace(streamingStartedAt),
        },
      ]);
      setContextBudget(null);

      let controller: AbortController | null = null;
      let accepted = false;
      try {
        controller = new AbortController();
        abortRef.current = controller;

        const requestBody = buildChatRequestBody({
          clientRunKey,
          conversationId,
          message: content.trim(),
          hiddenPrompt: input.hiddenPrompt,
          model,
          thinkingEnabled: true,
          reasoningEffort,
          projectId: options.projectId,
          selectedFileIds: options.selectedFileIds,
          mode: options.mode,
          webSearchActive: input.webSearchActive,
          manualSkillId: input.manualSkillId,
          skillOff: input.skillOff,
          isQuickTask: input.isQuickTask,
          materialScope: input.materialScope,
        });
        const fetchOptions: RequestInit = {
          method: "POST",
          signal: controller.signal,
        };
        if (attachments.length > 0) {
          fetchOptions.headers = { [CHAT_ATTACHMENT_EVENTS_HEADER]: "1" };
          const formData = new FormData();
          formData.append("message", JSON.stringify(requestBody));
          for (const attachment of attachments) {
            formData.append("attachments", attachment.data, attachment.name);
          }
          fetchOptions.body = formData;
        } else {
          fetchOptions.headers = { "Content-Type": "application/json" };
          fetchOptions.body = JSON.stringify(requestBody);
        }

        let response: Response;
        try {
          response = await fetch("/api/chat", fetchOptions);
        } catch (requestError) {
          if (attachments.length > 0 || controller.signal.aborted) {
            throw requestError;
          }
          // A transport can fail before response headers arrive even though
          // the durable dispatch committed. Retrying with the same key returns
          // the same AgentExecution and message pair.
          response = await fetch("/api/chat", fetchOptions);
        }

        if (!response.ok) {
          throw new Error(await readChatError(response));
        }

        accepted = true;
        if (streamSessionRef.current === streamSession) input.onAccepted?.();

        // Read the legacy header when a server rollback restores the old API.
        const persistedHeader = response.headers.get("X-Message-Attachments");
        if (persistedHeader) {
          try {
            const persisted = JSON.parse(
              decodeURIComponent(persistedHeader)
            ) as ChatAttachmentDto[];
            if (Array.isArray(persisted)) updatePersistedAttachments(persisted);
          } catch {
            // 头部损坏时保留本地预览，不阻断对话。
          }
        }

        // Get conversation ID from header if new
        const newConvId = response.headers.get("X-Conversation-Id");
        if (newConvId && !conversationId) {
          conversationIdRef.current = newConvId;
          setConversationId(newConvId);
          if (!options.projectId) {
            // Move /chat to /chat/<id> in place: /chat and /chat/[id] are
            // separate route segments, so router.push would swap page
            // components and unmount the streaming ChatArea. Project pages
            // keep their own /projects/<id> URL instead. (replaceState
            // precedent: use-hash-dialog.ts)
            window.history.replaceState(null, "", `/chat/${newConvId}`);
          }
          // Keep the response stream on the critical path; title generation is
          // a best-effort background refinement of the neutral "新对话" label.
          void fetch(`/api/conversations/${newConvId}/title`, {
            method: "POST",
          })
            .then((titleResponse) => {
              if (!titleResponse.ok) return;
              return Promise.all([
                queryClient.invalidateQueries({
                  queryKey: queryKeys.conversations.all,
                }),
                ...(options.projectId
                  ? [
                      queryClient.invalidateQueries({
                        queryKey: queryKeys.projects.detail(options.projectId),
                      }),
                    ]
                  : []),
              ]);
            })
            .catch(() => {});
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");
        const agentExecutionId = response.headers.get("X-Agent-Execution-Id");
        agentExecutionIdRef.current = agentExecutionId;

        const responseMessageId = response.headers.get("X-Message-Id");
        if (responseMessageId && responseMessageId !== streamingId) {
          const optimisticId = streamingId;
          streamingId = responseMessageId;
          setMessages((prev) =>
            prev.map((message) =>
              message.id === optimisticId
                ? { ...message, id: responseMessageId }
                : message
            )
          );
        }

        let fullContent = "";
        let fullReasoning = "";
        let lastEventSequence = 0;
        const streamSignal = controller.signal;
        let pendingUICommit: Promise<void> | undefined;
        const activeStream = () => streamSessionRef.current === streamSession && !streamSignal.aborted;
        const handleUI = (event: UIEvent) => {
          if (!activeStream() || event.messageId !== streamingId) return;
          if (event.kind === "commit") {
            const id = newConvId || conversationId;
            pendingUICommit = intelligentUIStream.commit(event, async () =>
              id ? (await fetchConversationMessages(id, streamSignal))?.find(({ id }) => id === streamingId)?.intelligentUI : undefined,
            activeStream);
          } else {
            return intelligentUIStream.accept(event, activeStream);
          }
        };

        const consumeStream = (
          activeReader: ReadableStreamDefaultReader<Uint8Array>
        ) => readSSEStream(
          activeReader,
          (chunk) => {
            if (chunk.done || (!chunk.content && !chunk.reasoningContent)) return;

            fullContent += chunk.content;
            fullReasoning += chunk.reasoningContent;

          // Update the streaming message in-place. If this stream was detached
          // by a conversation switch, the id will not exist in the visible list.
          setMessages((prev) =>
            prev.map((m) =>
              m.id === streamingId
                ? {
                    ...m,
                    content: fullContent,
                    reasoningContent: fullReasoning || null,
                  }
                : m
            )
          );
          },
          {
            onMessageAttachments: updatePersistedAttachments,
            onIntelligentUI: handleUI,
            onDiscardUIPreview: () => intelligentUIStream.discard(streamingId),
            onEventId: (sequence) => {
              lastEventSequence = Math.max(lastEventSequence, sequence);
            },
            onAgentEvent: (event) => {
              setMessages((prev) =>
                prev.map((message) =>
                  message.id === streamingId
                    ? {
                        ...message,
                        process: reduceAssistantProcess(
                          message.process ?? createAssistantProcessTrace(streamingStartedAt),
                          event
                        ),
                      }
                    : message
                )
              );
              if (event.type === "plan_updated") {
                setAgentSession((current) => ({ ...current, plan: event.plan }));
                return;
              }
              if (event.type === "skill_activated") {
                setAgentSession((current) => ({
                  ...current,
                  activeSkill: {
                    skillId: event.skillId,
                    version: event.version,
                    status: event.status,
                    reason: event.reason,
                  },
                }));
                return;
              }
              if (event.type === "skill_deactivated") {
                setAgentSession((current) => ({
                  ...current,
                  activeSkill: undefined,
                }));
                return;
              }
              if (event.type === "skill_suggested") {
                setAgentSession((current) => ({
                  ...current,
                  suggestions: event.suggestions,
                }));
                return;
              }
              if (event.type === "web_access_enabled") {
                setAgentSession((current) => ({
                  ...current,
                  webAccess: { mode: event.mode, reason: event.reason },
                }));
                return;
              }
              if (event.type === "model_adapter_selected") {
                setAgentSession((current) => ({
                  ...current,
                  modelAdapter: {
                    provider: event.provider,
                    model: event.model,
                    fallback: event.fallback,
                  },
                }));
                return;
              }
              if (event.type === "sources_updated") {
                setMessages((prev) =>
                  prev.map((message) =>
                    message.id === streamingId
                      ? { ...message, sources: event.sources }
                      : message
                  )
                );
                return;
              }
              if (event.type === "tool_proposed") {
                toolIdByExecution.set(event.executionId, event.preview.toolId);
              } else if (event.type === "tool_started") {
                activeExecutions.add(event.executionId);
                syncActiveTool();
              } else if (
                event.type === "tool_completed" ||
                event.type === "tool_failed" ||
                event.type === "tool_blocked"
              ) {
                activeExecutions.delete(event.executionId);
                toolsFinished += 1;
                syncActiveTool();
              }
              if (
                event.type === "context_budget_warning" ||
                event.type === "context_budget_compressed" ||
                event.type === "context_budget_overflow"
              ) {
                setContextBudget({
                  status:
                    event.type === "context_budget_warning"
                      ? "warn"
                      : event.type === "context_budget_compressed"
                        ? "compress"
                        : "overflow",
                  tokens: event.tokens,
                  ratio: event.ratio,
                });
                return;
              }

            },
          }
        );
        let result;
        let activeReader = reader;
        let reconnectAttempts = 0;
        while (true) {
          try {
            result = await consumeStream(activeReader);
            if (result.done || !agentExecutionId) break;
          } catch (streamError) {
            if (
              streamError instanceof SSEExecutionError ||
              !agentExecutionId ||
              controller.signal.aborted
            ) {
              throw streamError;
            }
          }
          reconnectAttempts += 1;
          if (reconnectAttempts > 3) {
            throw new Error("连接中断次数过多，请稍后从对话继续");
          }
          const replayResponse = await fetch(
            `/api/agent/executions/${encodeURIComponent(agentExecutionId)}/events?format=chat&afterSequence=${lastEventSequence}`,
            {
              signal: controller.signal,
              headers: attachments.length > 0 && !receivedAttachments
                ? { [CHAT_ATTACHMENT_EVENTS_HEADER]: "1" }
                : undefined,
            }
          );
          if (!replayResponse.ok) {
            throw new Error(await readChatError(replayResponse));
          }
          const replayReader = replayResponse.body?.getReader();
          if (!replayReader) throw new Error("No replay response body");
          activeReader = replayReader;
        }

        await pendingUICommit;
        intelligentUIStream.discard(streamingId);
        // Stream complete
        if (result.usage) {
          setUsage(result.usage);
        }

        setMessages((prev) =>
          prev.map((m) =>
            m.id === streamingId
              ? {
                  ...m,
                  content: fullContent,
                  intelligentUI: intelligentUIStream.get(streamingId),
                  reasoningContent: fullReasoning || null,
                  isStreaming: false,
                  streamingSource: undefined,
                  streamingStartedAt: undefined,
                  activeToolId: null,
                  toolsUsed: toolsFinished,
                  tokenCount: result.usage?.totalTokens ?? null,
                  cacheHitTokens: result.usage?.cacheHitTokens ?? null,
                  cacheMissTokens: result.usage?.cacheMissTokens ?? null,
                  process: completeAssistantProcess(
                    m.process ?? createAssistantProcessTrace(streamingStartedAt),
                    "completed"
                  ),
                }
              : m
          )
        );
        await queryClient.invalidateQueries({
          queryKey: queryKeys.conversations.all,
        });
        if (newConvId || conversationId) {
          await queryClient.invalidateQueries({
            queryKey: queryKeys.conversations.detail(
              newConvId || conversationId || ""
            ),
          });
        }
      } catch (err) {
        intelligentUIStream.discard(streamingId);
        const isCancelledExecution =
          err instanceof SSEExecutionError && err.status === "cancelled";
        if (
          (err instanceof Error && err.name === "AbortError") ||
          isCancelledExecution
        ) {
          // User aborted the attached foreground stream (or the durable
          // execution was cancelled server-side): keep the partial content.
          if (streamSessionRef.current === streamSession) {
            setMessages((prev) =>
              prev.map((m) =>
                m.isStreaming
                  ? {
                      ...m,
                      isStreaming: false,
                      streamingSource: undefined,
                      streamingStartedAt: undefined,
                      activeToolId: null,
                      toolsUsed: toolsFinished,
                      process: completeAssistantProcess(
                        m.process ?? createAssistantProcessTrace(streamingStartedAt),
                        "cancelled"
                      ),
                    }
                  : m
              )
            );
          }
        } else {
          if (streamSessionRef.current === streamSession) {
            setError(
              err instanceof Error ? err.message : "An unexpected error occurred"
            );
            // A renderer may have finished even if the final model summary failed.
            setMessages((prev) => prev.flatMap((message) => {
              if (message.id !== streamingId) return [message];
              if (!message.process?.tools.some((tool) => tool.download)) return [];
              return [{
                ...message,
                isStreaming: false,
                streamingSource: undefined,
                process: completeAssistantProcess(message.process, "failed"),
              }];
            }));
            return false;
          }
        }
      } finally {
        if (!accepted && attachments.length > 0) {
          releaseSendPreviews();
          if (streamSessionRef.current === streamSession) {
            setMessages((prev) => prev.filter((message) =>
              message.id !== userMessage.id && message.id !== streamingId
            ));
          }
        }
        if (streamSessionRef.current === streamSession) {
          setIsStreaming(false);
        }
        agentExecutionIdRef.current = null;
        if (controller && abortRef.current === controller) {
          abortRef.current = null;
        }
      }
      return true;
    },
    [
      modelBlockedReason,
      conversationId,
      intelligentUIStream,
      model,
      reasoningEffort,
      options.projectId,
      options.selectedFileIds,
      options.mode,
      queryClient,
    ]
  );
  const sendMutation = useMutation({ mutationFn: performSend });
  const sendMessage = useCallback(
    (input: string | SendMessageInput) =>
      sendMutation.mutateAsync(
        typeof input === "string" ? { content: input } : input
      ),
    [sendMutation]
  );

  const background = messages.find((message) => message.isStreaming && message.backgroundExecutionId);
  const backgroundId = background?.backgroundExecutionId;
  const backgroundMessageId = background?.id;
  const recoverUI = background?.intelligentUIStreaming === true;
  useEffect(() => {
    if (!recoverUI || !conversationId || !backgroundId || !backgroundMessageId) return;
    const executionId = backgroundId;
    const messageId = backgroundMessageId;
    const controller = new AbortController();
    const { signal } = controller;
    const active = () => !signal.aborted;
    let timer: ReturnType<typeof setTimeout>;
    let sequence = 0;
    let loaded: ChatMessage[] | undefined;
    let commit: Promise<void> | undefined;
    const load = () => fetchConversationMessages(conversationId, signal);
    async function refresh() {
      try {
        const response = await fetch(
          `/api/agent/executions/${encodeURIComponent(executionId)}/events?format=chat&afterSequence=${sequence}`, { signal },
        );
        if ([401, 404].includes(response.status)) {
          intelligentUIStream.discard(messageId);
          if (active()) {
            setMessages((current) => current.map((message) => message.id === backgroundMessageId
              ? { ...message, isStreaming: false, streamingSource: undefined, backgroundExecutionId: undefined } : message));
            setIsStreaming(false);
          }
          return;
        }
        if (!response.ok || !response.body) throw new Error("Could not recover chat event stream");
        const result = await readSSEStream(response.body.getReader(), () => {}, {
          onEventId: (id) => { sequence = Math.max(sequence, id); },
          onDiscardUIPreview: () => intelligentUIStream.discard(messageId),
          onIntelligentUI: (event) => {
            if (!active() || event.messageId !== backgroundMessageId) return;
            if (event.kind === "commit") {
              commit = intelligentUIStream.commit(event, async () => {
                loaded = await load();
                return loaded?.find(({ id }) => id === backgroundMessageId)?.intelligentUI;
              }, active);
            } else {
              return intelligentUIStream.accept(event, active);
            }
          },
        });
        if (!result.done) throw new Error("Chat event stream disconnected");
        await commit;
        loaded ??= await load();
      } catch (error) {
        if (error instanceof SSEExecutionError) {
          intelligentUIStream.discard(messageId);
          loaded = await load().catch(() => undefined);
        }
      }
      if (!active()) return;
      if (loaded) {
        setMessages(loaded);
        setIsStreaming(false);
      } else {
        timer = setTimeout(() => void refresh(), 1_000);
      }
    }
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [recoverUI, conversationId, backgroundId, backgroundMessageId, intelligentUIStream]);
  useEffect(() => {
    // Project conversations already have a recovery poll. The standalone chat
    // checks the light status DTO and fetches the transcript once at completion.
    if (recoverUI || !backgroundId || !conversationId || options.projectId) return;
    const executionPath = `/api/agent/executions/${encodeURIComponent(backgroundId)}?view=status`;
    const detailPath = `/api/conversations/${encodeURIComponent(conversationId)}`;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const response = await fetch(executionPath, { signal: controller.signal });
        if (response.ok) {
          const { status } = await response.json() as { status: string };
          if (["completed", "failed", "cancelled"].includes(status)) {
            const detail = await fetch(detailPath, { signal: controller.signal });
            if (detail.ok) {
              const { conversation } = await detail.json() as { conversation: { messages: ChatMessage[] } };
              if (!controller.signal.aborted) {
                setMessages(conversation.messages);
                setIsStreaming(false);
              }
              return;
            }
          }
        } else if ([401, 404].includes(response.status)) {
          if (!controller.signal.aborted) {
            setIsStreaming(false);
            setMessages((current) => current.map((message) => message.backgroundExecutionId === backgroundId
              ? { ...message, isStreaming: false, backgroundExecutionId: undefined, streamingSource: undefined } : message));
          }
          return;
        }
      } catch {
        // Reconnect on the next tick unless the user switched conversation.
      }
      if (!controller.signal.aborted) timer = setTimeout(() => void refresh(), 3_000);
    }
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [backgroundId, conversationId, options.projectId, recoverUI]);

  const abort = useCallback(() => {
    // durable 模式下仅断开本地流不会让模型停止：执行跑在后台 worker。
    // 先通知服务端取消（worker 心跳感知后软停止），再断开本地渲染。
    const executionId = agentExecutionIdRef.current ?? backgroundId;
    if (executionId) {
      agentExecutionIdRef.current = null;
      void fetch(
        `/api/agent/executions/${encodeURIComponent(executionId)}/cancel`,
        { method: "POST" }
      ).catch(() => {});
    }
    abortRef.current?.abort();
  }, [backgroundId]);

  const clearError = useCallback(() => setError(null), []);

  const newConversation = useCallback(() => {
    streamSessionRef.current += 1;
    abortRef.current = null;
    agentExecutionIdRef.current = null;
    conversationIdRef.current = undefined;
    intelligentUIStream.clear();
    setModel(chatModelForPreference(options.projectId ? options.model : undefined));
    setMessages([]);
    setConversationId(undefined);
    setUsage(null);
    setContextBudget(null);
    setError(null);
    setIsStreaming(false);
    setAgentSession({ suggestions: [] });
  }, [options.projectId, options.model, intelligentUIStream]);

  const loadConversation = useCallback(
    (
      nextConversationId: string,
      nextMessages: ChatMessage[],
      settings?: { model?: string; thinkingEnabled?: boolean }
    ) => {
      streamSessionRef.current += 1;
      abortRef.current = null;
      if (conversationIdRef.current !== nextConversationId) intelligentUIStream.clear();
      conversationIdRef.current = nextConversationId;
      setConversationId(nextConversationId);
      setMessages(nextMessages);
      if (settings?.model) setModel(chatModelForPreference(settings.model));
      setThinkingEnabledState(true);
      setUsage(null);
      setContextBudget(null);
      setError(null);
      setIsStreaming(hasStreamingMessage(nextMessages));
      setAgentSession({ suggestions: [] });
    },
    [intelligentUIStream]
  );

  return {
    messages,
    intelligentUIStream,
    isStreaming,
    error,
    conversationId,
    usage,
    model,
    availableModels,
    modelBlockedReason,
    thinkingEnabled,
    reasoningEffort,
    setModel,
    setThinkingEnabled,
    setReasoningEffort,
    sendMessage,
    abort,
    clearError,
    newConversation,
    loadConversation,
    agentSession,
    contextBudget,
  };
}
