"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";
import type { PaperWorkspaceSummary } from "@/lib/api/types";

export function usePaperWorkspaces() {
  return useQuery({
    queryKey: queryKeys.papers.workspaces,
    queryFn: async () => (await fetchJson<{ workspaces: PaperWorkspaceSummary[] }>("/api/papers/workspaces")).workspaces,
  });
}

export function usePaperWorkspace(id: string | null) {
  return useQuery({
    queryKey: queryKeys.papers.workspace(id ?? "none"),
    enabled: Boolean(id),
    queryFn: async () => (await fetchJson<{ workspace: unknown }>(`/api/papers/workspaces/${id}`)).workspace,
  });
}

export function useCreatePaperWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; description?: string; projectId?: string }) => (await fetchJson<{ workspace: PaperWorkspaceSummary }>("/api/papers/workspaces", { method: "POST", body: JSON.stringify(input) })).workspace,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.papers.workspaces }),
  });
}

export function usePaperTemplates(query = "") {
  return useQuery({
    queryKey: queryKeys.papers.templates(query),
    queryFn: async () => (await fetchJson<{ templates: unknown[] }>(`/api/papers/templates${query ? `?q=${encodeURIComponent(query)}` : ""}`)).templates,
  });
}
