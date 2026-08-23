"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";
import type { ResearchWorkspaceSummary } from "@/lib/api/types";

export function useResearchWorkspaces() {
  return useQuery({
    queryKey: queryKeys.research.workspaces,
    queryFn: async () => (await fetchJson<{ workspaces: ResearchWorkspaceSummary[] }>("/api/research/workspaces")).workspaces,
  });
}

export function useResearchWorkspace(id: string | null) {
  return useQuery({
    queryKey: queryKeys.research.workspace(id ?? "none"),
    enabled: Boolean(id),
    queryFn: async () => (await fetchJson<{ workspace: unknown }>(`/api/research/workspaces/${id}`)).workspace,
  });
}

export function useResearchRun(id: string | null) {
  return useQuery({
    queryKey: queryKeys.research.run(id ?? "none"),
    enabled: Boolean(id),
    queryFn: async () => (await fetchJson<{ run: unknown }>(`/api/research/runs/${id}`)).run,
  });
}

export function useCreateResearchWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; description?: string; projectId?: string; budgetProfile?: "quick" | "deep" | "comprehensive" }) => (await fetchJson<{ workspace: ResearchWorkspaceSummary }>("/api/research/workspaces", { method: "POST", body: JSON.stringify(input) })).workspace,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.research.workspaces }),
  });
}

export function useCreateResearchRun(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { question: string; budgetProfile?: "quick" | "deep" | "comprehensive" }) => (await fetchJson<{ run: unknown }>(`/api/research/workspaces/${workspaceId}/runs`, { method: "POST", body: JSON.stringify(input) })).run,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.research.workspace(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.research.workspaces });
    },
  });
}

export function useConfirmResearchPlan(runId: string, workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => (await fetchJson<{ run: unknown }>(`/api/research/runs/${runId}/plan/confirm`, { method: "POST" })).run,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.research.workspace(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.research.run(runId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.research.workspaces });
    },
  });
}
