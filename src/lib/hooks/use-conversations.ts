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
