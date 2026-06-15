"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api/client";
import type { ApiKeyProvider, ApiKeyResponse } from "@/lib/api/types";
import { queryKeys } from "@/lib/query-keys";

export function useApiKeys() {
  return useQuery({
    queryKey: queryKeys.keys,
    queryFn: () => fetchJson<ApiKeyResponse>("/api/keys"),
  });
}

export function useUpdateApiKeys() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      provider,
      key,
    }: {
      provider: ApiKeyProvider;
      key: string;
    }) =>
      fetchJson<{ success: true; provider: ApiKeyProvider; keyPrefix: string }>(
        "/api/keys",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider, key }),
        }
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.keys }),
  });
}

export function useDeleteApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (provider: ApiKeyProvider) =>
      fetchJson<{ success: true; provider: ApiKeyProvider }>(
        `/api/keys?provider=${provider}`,
        { method: "DELETE" }
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.keys }),
  });
}
