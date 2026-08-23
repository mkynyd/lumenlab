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

export function usePaperReferences(id: string | null) {
  return useQuery({
    queryKey: queryKeys.papers.references(id ?? "none"),
    enabled: Boolean(id),
    queryFn: async () => (await fetchJson<{ references: unknown[] }>(`/api/papers/workspaces/${id}/references`)).references,
  });
}

export function useCreatePaperReference(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { action: "manual" | "doi" | "bibtex"; title?: string; authors?: string[]; year?: number | null; venue?: string | null; doi?: string | null; arxivId?: string | null; url?: string | null; bibtex?: string }) => fetchJson(`/api/papers/workspaces/${workspaceId}/references`, { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.papers.references(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.papers.workspace(workspaceId) });
    },
  });
}
