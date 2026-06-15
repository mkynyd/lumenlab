"use client";

import { useState, useCallback, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  readSSEStream,
  type UsageInfo,
} from "@/lib/sse-client";
import {
  buildChatRequestBody,
} from "@/lib/chat-request";
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
  const [thinkingEnabled, setThinkingEnabled] = useState(
    options.thinkingEnabled ?? false
  );
  const abortRef = useRef<AbortController | null>(null);

  const performSend = useCallback(
    async (content: string) => {
      if (!content.trim()) return;

      // Abort any previous stream
      abortRef.current?.abort();

      setError(null);
      setIsStreaming(true);

      const userMessage: ChatMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: content.trim(),
      };

      setMessages((prev) => [...prev, userMessage]);

      try {
        const controller = new AbortController();
        abortRef.current = controller;

        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildChatRequestBody({
            conversationId,
            message: content.trim(),
            model,
            thinkingEnabled,
            reasoningEffort: options.reasoningEffort ?? "high",
            projectId: options.projectId,
            selectedFileIds: options.selectedFileIds,
            mode: options.mode,
          })),
          signal: controller.signal,
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || `Request failed (${response.status})`);
        }

        // Get conversation ID from header if new
        const newConvId = response.headers.get("X-Conversation-Id");
        if (newConvId && !conversationId) {
          setConversationId(newConvId);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        // Track streaming assistant message
        const streamingId =
          response.headers.get("X-Message-Id") || `assistant-${Date.now()}`;
        setMessages((prev) => [
          ...prev,
          {
            id: streamingId,
            role: "assistant",
            content: "",
            reasoningContent: null,
            isStreaming: true,
          },
        ]);

        let fullContent = "";
        let fullReasoning = "";

        const result = await readSSEStream(reader, (chunk) => {
          if (chunk.done) return;

          fullContent += chunk.content;
          fullReasoning += chunk.reasoningContent;

          // Update the streaming message in-place
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
          // User aborted — mark streaming message as done
          setMessages((prev) =>
            prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m))
          );
        } else {
          setError(
            err instanceof Error ? err.message : "An unexpected error occurred"
          );
          // Remove the streaming placeholder on error
          setMessages((prev) => prev.filter((m) => !m.isStreaming));
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [
      conversationId,
      model,
      thinkingEnabled,
      options.reasoningEffort,
      options.projectId,
      options.selectedFileIds,
      options.mode,
      queryClient,
    ]
  );
  const sendMutation = useMutation({ mutationFn: performSend });
  const sendMessage = useCallback(
    (content: string) => sendMutation.mutateAsync(content),
    [sendMutation]
  );

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const newConversation = useCallback(() => {
    setMessages([]);
    setConversationId(undefined);
    setUsage(null);
    setError(null);
    abortRef.current?.abort();
  }, []);

  const loadConversation = useCallback(
    (nextConversationId: string, nextMessages: ChatMessage[]) => {
      abortRef.current?.abort();
      setConversationId(nextConversationId);
      setMessages(nextMessages);
      setUsage(null);
      setError(null);
      setIsStreaming(false);
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
    setModel,
    setThinkingEnabled,
    sendMessage,
    abort,
    clearError,
    newConversation,
    loadConversation,
  };
}
