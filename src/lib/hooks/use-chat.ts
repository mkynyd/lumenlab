"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  readSSEStream,
  type UsageInfo,
} from "@/lib/sse-client";
import {
  buildChatRequestBody,
} from "@/lib/chat-request";
import type { FileAttachment } from "@/lib/chat/router";
import type { ProjectType } from "@/components/chat/quick-task-bar";
import { queryKeys } from "@/lib/query-keys";
import type { AgentEvent, ApprovalScope } from "@/lib/agent/types";
import type { AgentSource } from "@/lib/agent/sources";

export interface AgentTimelineEntry {
  executionId: string;
  /** Latest event for this execution, replaces previous state. */
  latestEvent: AgentEvent;
  /** Resolved on approve; only present once user has acted. */
  approvedScope?: ApprovalScope;
  /** Stored when awaiting approval so the UI can call /api/agent/approve. */
  approvalToken?: string;
  approvalExpiresAt?: number;
}

export interface AgentSessionState {
  activeSkill?: {
    skillId: string;
    version: string;
    status?: "active" | "awaiting_context";
    reason?: string;
  };
  suggestions: Array<{ skillId: string; label: string; reason: string }>;
  webAccess?: { mode: "auto" | "manual"; reason: string };
  modelAdapter?: {
    provider: "deepseek" | "minimax";
    model: string;
    fallback: "native_tools" | "json_action" | "prefetch_tools" | "none";
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
}

export interface SendMessageInput {
  content: string;
  hiddenPrompt?: string;
  attachments?: FileAttachment[];
  webSearchActive?: boolean;
  manualSkillId?: string;
  skillOff?: boolean;
}

interface UseChatOptions {
  initialMessages?: ChatMessage[];
  initialConversationId?: string;
  model?: string;
  thinkingEnabled?: boolean;
  reasoningEffort?: "high" | "max";
  projectId?: string;
  selectedFileIds?: string[];
  mode?: ProjectType;
}

type ReasoningEffort = NonNullable<UseChatOptions["reasoningEffort"]>;

function hasStreamingMessage(messages: ChatMessage[]) {
  return messages.some((message) => message.isStreaming);
}

export function useChat(options: UseChatOptions = {}) {
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<ChatMessage[]>(
    options.initialMessages || []
  );
  const [isStreaming, setIsStreaming] = useState(false);
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
  const [model, setModel] = useState(options.model || "deepseek-v4-pro");
  const [thinkingEnabled, setThinkingEnabledState] = useState(true);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(
    options.reasoningEffort ?? "max"
  );
  const [agentTimeline, setAgentTimeline] = useState<
    Record<string, AgentTimelineEntry>
  >({});
  const [agentSession, setAgentSession] = useState<AgentSessionState>({
    suggestions: [],
  });
  const abortRef = useRef<AbortController | null>(null);
  const conversationIdRef = useRef<string | undefined>(
    options.initialConversationId
  );
  const streamSessionRef = useRef(0);

  const setThinkingEnabled = useCallback(() => {
    setThinkingEnabledState(true);
  }, []);

  useEffect(() => {
    if (conversationId || messages.length > 0) return;
    const nextModel = options.model;
    const nextReasoningEffort = options.reasoningEffort;
    queueMicrotask(() => {
      if (nextModel) setModel(nextModel);
      if (nextReasoningEffort) {
        setReasoningEffort(nextReasoningEffort);
      }
      setThinkingEnabledState(true);
    });
  }, [conversationId, messages.length, options.model, options.reasoningEffort]);

  const performSend = useCallback(
    async (input: SendMessageInput) => {
      const attachments = input.attachments || [];
      const content = input.content.trim() || (attachments.length > 0 ? "请阅读附件。" : "");
      if (!content.trim() && attachments.length === 0) return;

      // Abort any still-attached foreground stream before sending a new message.
      abortRef.current?.abort();
      setAgentTimeline({});
      setAgentSession({ suggestions: [] });
      const streamSession = streamSessionRef.current + 1;
      streamSessionRef.current = streamSession;

      setError(null);
      setIsStreaming(true);

      const userMessage: ChatMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: attachments.length > 0
          ? `${content.trim()}\n\n${attachments.map((attachment) => `[附件] ${attachment.name}`).join("\n")}`
          : content.trim(),
      };
      let streamingId = `assistant-${Date.now()}`;
      const streamingStartedAt = Date.now();
      let streamConversationId = conversationId;

      setMessages((prev) => [
        ...prev,
        userMessage,
        {
          id: streamingId,
          role: "assistant",
          content: "",
          reasoningContent: null,
          isStreaming: true,
          streamingSource: "foreground",
          streamingStartedAt,
        },
      ]);
      setContextBudget(null);

      let controller: AbortController | null = null;
      try {
        controller = new AbortController();
        abortRef.current = controller;

        const requestBody = buildChatRequestBody({
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
        });
        const fetchOptions: RequestInit = {
          method: "POST",
          signal: controller.signal,
        };
        if (attachments.length > 0) {
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

        const response = await fetch("/api/chat", fetchOptions);

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || `Request failed (${response.status})`);
        }

        // Get conversation ID from header if new
        const newConvId = response.headers.get("X-Conversation-Id");
        if (newConvId && !conversationId) {
          conversationIdRef.current = newConvId;
          streamConversationId = newConvId;
          setConversationId(newConvId);
        } else if (newConvId) {
          streamConversationId = newConvId;
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

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

        const result = await readSSEStream(
          reader,
          (chunk) => {
            if (chunk.done) return;

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
            onAgentEvent: (event) => {
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
              if (!("executionId" in event)) {
                // Skill/web/model lifecycle is informational; timeline only tracks executions.
                return;
              }
              const executionId = event.executionId;
              setAgentTimeline((prev) => {
                const existing = prev[executionId];
                if (event.type === "approval_required") {
                  return {
                    ...prev,
                    [executionId]: {
                      executionId,
                      latestEvent: event,
                      approvalToken: event.token,
                      approvalExpiresAt: event.expiresAt,
                    },
                  };
                }
                return {
                  ...prev,
                  [executionId]: {
                    executionId,
                    latestEvent: event,
                    ...(existing?.approvalToken
                      ? { approvalToken: existing.approvalToken }
                      : {}),
                    ...(existing?.approvalExpiresAt
                      ? { approvalExpiresAt: existing.approvalExpiresAt }
                      : {}),
                  },
                };
              });
            },
          }
        );

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
                  reasoningContent: fullReasoning || null,
                  isStreaming: false,
                  streamingSource: undefined,
                  streamingStartedAt: undefined,
                  tokenCount: result.usage?.totalTokens ?? null,
                  cacheHitTokens: result.usage?.cacheHitTokens ?? null,
                  cacheMissTokens: result.usage?.cacheMissTokens ?? null,
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
        if (err instanceof Error && err.name === "AbortError") {
          // User aborted the attached foreground stream.
          if (
            streamSessionRef.current === streamSession ||
            conversationIdRef.current === streamConversationId
          ) {
            setMessages((prev) =>
              prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m))
            );
          }
        } else {
          if (
            streamSessionRef.current === streamSession ||
            conversationIdRef.current === streamConversationId
          ) {
            setError(
              err instanceof Error ? err.message : "An unexpected error occurred"
            );
            // Remove the streaming placeholder on foreground error.
            setMessages((prev) => prev.filter((m) => !m.isStreaming));
          }
        }
      } finally {
        if (
          streamSessionRef.current === streamSession ||
          conversationIdRef.current === streamConversationId
        ) {
          setIsStreaming(false);
        }
        if (controller && abortRef.current === controller) {
          abortRef.current = null;
        }
      }
    },
    [
      conversationId,
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

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const newConversation = useCallback(() => {
    streamSessionRef.current += 1;
    abortRef.current = null;
    conversationIdRef.current = undefined;
    setMessages([]);
    setConversationId(undefined);
    setUsage(null);
    setContextBudget(null);
    setError(null);
    setIsStreaming(false);
    setAgentTimeline({});
    setAgentSession({ suggestions: [] });
  }, []);

  const loadConversation = useCallback(
    (
      nextConversationId: string,
      nextMessages: ChatMessage[],
      settings?: { model?: string; thinkingEnabled?: boolean }
    ) => {
      streamSessionRef.current += 1;
      abortRef.current = null;
      conversationIdRef.current = nextConversationId;
      setConversationId(nextConversationId);
      setMessages(nextMessages);
      if (settings?.model) setModel(settings.model);
      setThinkingEnabledState(true);
      setUsage(null);
      setContextBudget(null);
      setError(null);
      setIsStreaming(hasStreamingMessage(nextMessages));
      setAgentTimeline({});
      setAgentSession({ suggestions: [] });
    },
    []
  );

  const approveExecution = useCallback(
    async (executionId: string, token: string, scope: ApprovalScope) => {
      const entry = agentTimeline[executionId];
      if (!entry) return;
      const response = await fetch("/api/agent/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          executionId,
          scope,
        }),
      });
      if (!response.ok) {
        setError(`审批失败 (${response.status})`);
        return;
      }
      setAgentTimeline((prev) => {
        const existing = prev[executionId];
        if (!existing) return prev;
        return {
          ...prev,
          [executionId]: {
            ...existing,
            latestEvent: {
              type: "approval_granted",
              executionId,
              scope,
            },
            approvedScope: scope,
            approvalToken: undefined,
            approvalExpiresAt: undefined,
          },
        };
      });
    },
    [agentTimeline]
  );

  const rejectExecution = useCallback(
    async (executionId: string) => {
      const response = await fetch("/api/agent/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ executionId }),
      });
      if (!response.ok) {
        setError(`拒绝失败 (${response.status})`);
        return;
      }
      setAgentTimeline((prev) => {
        const existing = prev[executionId];
        if (!existing) return prev;
        return {
          ...prev,
          [executionId]: {
            ...existing,
            latestEvent: {
              type: "approval_denied",
              executionId,
            },
            approvalToken: undefined,
            approvalExpiresAt: undefined,
          },
        };
      });
    },
    []
  );

  return {
    messages,
    isStreaming,
    error,
    conversationId,
    usage,
    model,
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
    agentTimeline,
    agentSession,
    approveExecution,
    rejectExecution,
    contextBudget,
  };
}
