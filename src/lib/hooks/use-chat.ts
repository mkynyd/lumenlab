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

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  reasoningContent?: string | null;
  tokenCount?: number | null;
  cacheHitTokens?: number | null;
  cacheMissTokens?: number | null;
  isStreaming?: boolean;
  streamingSource?: "foreground" | "background";
  streamingStartedAt?: number;
}

export interface SendMessageInput {
  content: string;
  hiddenPrompt?: string;
  attachments?: FileAttachment[];
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
  const [model, setModel] = useState(options.model || "deepseek-v4-pro");
  const [thinkingEnabled, setThinkingEnabledState] = useState(true);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(
    options.reasoningEffort ?? "max"
  );
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

        const result = await readSSEStream(reader, (chunk) => {
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
        });

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
    setError(null);
    setIsStreaming(false);
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
      setError(null);
      setIsStreaming(hasStreamingMessage(nextMessages));
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
  };
}
