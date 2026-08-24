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

export interface PaperTemplateQuery {
  query?: string;
  format?: string;
  status?: string;
  recommendationLevel?: string;
  limit?: number;
}

export function usePaperTemplates(input: string | PaperTemplateQuery = "", options: { enabled?: boolean } = {}) {
  const filters: PaperTemplateQuery = typeof input === "string" ? { query: input } : input;
  const params = new URLSearchParams();
  if (filters.query?.trim()) params.set("q", filters.query.trim());
  if (filters.format) params.set("format", filters.format);
  if (filters.status) params.set("status", filters.status);
  if (filters.recommendationLevel) params.set("recommendation", filters.recommendationLevel);
  params.set("limit", String(filters.limit ?? 1000));
  const queryString = params.toString();
  return useQuery({
    queryKey: queryKeys.papers.templates(queryString),
    enabled: options.enabled ?? true,
    queryFn: async () => (await fetchJson<{ templates: unknown[] }>(`/api/papers/templates?${queryString}`)).templates,
  });
}

export function useBindPaperTemplate(workspaceId: string, documentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { templateVariantId: string; lockedVersion: string }) => (await fetchJson<{ binding: unknown }>(`/api/papers/documents/${documentId}/template`, { method: "POST", body: JSON.stringify(input) })).binding,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.papers.workspace(workspaceId) }),
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
