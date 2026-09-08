"use client";

import { useQuery } from "@tanstack/react-query";
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
