"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api/client";
import type {
  ArtifactDetail,
  ArtifactSummary,
} from "@/lib/api/types";
import { queryKeys } from "@/lib/query-keys";

export interface SaveArtifactInput {
  messageId?: string;
  conversationId?: string;
  title: string;
  type: string;
  content: string;
}

export function useProjectArtifacts(projectId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.projects.artifacts(projectId || ""),
    queryFn: async () =>
      (
        await fetchJson<{ artifacts: ArtifactSummary[] }>(
          `/api/projects/${projectId}/artifacts`
        )
      ).artifacts,
    enabled: Boolean(projectId),
  });
}

export function useArtifact(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.artifacts.detail(id || ""),
    queryFn: async () =>
      (
        await fetchJson<{ artifact: ArtifactDetail }>(`/api/artifacts/${id}`)
      ).artifact,
    enabled: Boolean(id),
  });
}

export function useSaveArtifact(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveArtifactInput) =>
      fetchJson<{ artifact: ArtifactDetail }>(
        `/api/projects/${projectId}/artifacts`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        }
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.projects.artifacts(projectId),
      }),
  });
}

export function useDeleteArtifact(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetchJson<{ success: true }>(`/api/artifacts/${id}`, {
        method: "DELETE",
      }),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: queryKeys.artifacts.detail(id) });
      return queryClient.invalidateQueries({
        queryKey: queryKeys.projects.artifacts(projectId),
      });
    },
  });
}
