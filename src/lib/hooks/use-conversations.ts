"use client";

import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { fetchJson } from "@/lib/api/client";
import type {
  ConversationDetail,
  ConversationSummary,
} from "@/lib/api/types";
import { queryKeys } from "@/lib/query-keys";

export function conversationQueryOptions(id: string) {
  return queryOptions({
    queryKey: queryKeys.conversations.detail(id),
    queryFn: async () =>
      (
        await fetchJson<{ conversation: ConversationDetail }>(
          `/api/conversations/${id}`
        )
      ).conversation,
    staleTime: 0,
  });
}

export function useConversations() {
  return useQuery({
    queryKey: queryKeys.conversations.all,
    queryFn: async () =>
      (
        await fetchJson<{ conversations: ConversationSummary[] }>(
          "/api/conversations"
        )
      ).conversations,
  });
}

export function useConversation(id: string | undefined) {
  const queryClient = useQueryClient();
  return useQuery({
    ...conversationQueryOptions(id || ""),
    enabled: Boolean(id),
    refetchOnMount: "always",
    placeholderData: () =>
      id
        ? queryClient.getQueryData<ConversationDetail>(
            queryKeys.conversations.detail(id)
          )
        : undefined,
  });
}

export function useRenameConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      fetchJson<{ title: string }>(`/api/conversations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      }),
    onMutate: async ({ id, title }) => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.conversations.all,
      });
      const previous = queryClient.getQueryData<ConversationSummary[]>(
        queryKeys.conversations.all
      );
      queryClient.setQueryData<ConversationSummary[]>(
        queryKeys.conversations.all,
        (current = []) =>
          current.map((item) =>
            item.id === id ? { ...item, title } : item
          )
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          queryKeys.conversations.all,
          context.previous
        );
      }
    },
    onSuccess: (data, { id }) => {
      queryClient.setQueryData<ConversationDetail>(
        queryKeys.conversations.detail(id),
        (current) => (current ? { ...current, title: data.title } : current)
      );
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.conversations.all,
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projects.all }),
      ]),
  });
}

export function useDeleteConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetchJson<{ success: true }>(`/api/conversations/${id}`, {
        method: "DELETE",
      }),
    onMutate: async (id) => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.conversations.all,
      });
      const previous = queryClient.getQueryData<ConversationSummary[]>(
        queryKeys.conversations.all
      );
      queryClient.setQueryData<ConversationSummary[]>(
        queryKeys.conversations.all,
        (current = []) => current.filter((item) => item.id !== id)
      );
      return { previous };
    },
    onError: (_error, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          queryKeys.conversations.all,
          context.previous
        );
      }
    },
    onSuccess: (_data, id) => {
      queryClient.removeQueries({
        queryKey: queryKeys.conversations.detail(id),
      });
    },
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.conversations.all,
      }),
  });
}
