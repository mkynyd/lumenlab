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
    refetchInterval: 4_000,
    queryFn: async () => (await fetchJson<{ run: unknown }>(`/api/research/runs/${id}`)).run,
  });
}

export function useCreateResearchWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; description?: string; projectId?: string; domainProfileKey?: string; budgetProfile?: "quick" | "deep" | "comprehensive" }) => (await fetchJson<{ workspace: ResearchWorkspaceSummary }>("/api/research/workspaces", { method: "POST", body: JSON.stringify(input) })).workspace,
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

export function useCancelResearchRun(runId: string, workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => (await fetchJson<{ run: unknown }>(`/api/research/runs/${runId}`, { method: "DELETE" })).run,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.research.workspace(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.research.run(runId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.research.workspaces });
    },
  });
}

export function useCreateResearchFollowUp(runId: string, workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (question: string) => (await fetchJson<{ run: { id: string; status: string } }>(`/api/research/runs/${runId}`, { method: "POST", body: JSON.stringify({ question }) })).run,
    onSuccess: (run) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.research.workspace(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.research.run(runId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.research.run(run.id) });
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

export function useReviseResearchPlan(runId: string, workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (directive: string) => (await fetchJson<{ plan: unknown }>(`/api/research/runs/${runId}/plan`, { method: "PATCH", body: JSON.stringify({ directive }) })).plan,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.research.workspace(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.research.run(runId) });
    },
  });
}

export function useAppendResearchDirective(runId: string, workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (text: string) => (await fetchJson<{ directive: unknown }>(`/api/research/runs/${runId}/directives`, { method: "POST", body: JSON.stringify({ text }) })).directive,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.research.workspace(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.research.run(runId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.research.workspaces });
    },
  });
}

export function useConfirmResearchScope(runId: string, workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { approved: boolean; budgetProfile?: "quick" | "deep" | "comprehensive" }) => (await fetchJson<{ run: unknown }>(`/api/research/runs/${runId}/scope/confirm`, { method: "POST", body: JSON.stringify(input) })).run,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.research.workspace(workspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.research.run(runId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.research.workspaces });
    },
  });
}

export function useCreateResearchEvidence(runId: string, workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { sourceSnapshotId: string; questionId?: string | null; statement: string; excerpt: string; locator: Record<string, unknown>; evidenceType: string; tags?: string[] }) => (await fetchJson<{ evidence: unknown }>(`/api/research/runs/${runId}/evidence`, { method: "POST", body: JSON.stringify(input) })).evidence,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.research.run(runId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.research.workspace(workspaceId) });
    },
  });
}

export function useUpdateResearchEvidence(runId: string, workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { evidenceId: string; status?: "disputed" | "invalidated"; statement?: string; excerpt?: string; locator?: Record<string, unknown>; evidenceType?: string; tags?: string[]; sourceSnapshotId?: string; revisionReason?: string }) => (await fetchJson<{ evidence: unknown }>(`/api/research/runs/${runId}/evidence/${input.evidenceId}`, { method: "PATCH", body: JSON.stringify(input.status ? { status: input.status } : { statement: input.statement, excerpt: input.excerpt, locator: input.locator, evidenceType: input.evidenceType, tags: input.tags, sourceSnapshotId: input.sourceSnapshotId, revisionReason: input.revisionReason }) })).evidence,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.research.run(runId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.research.workspace(workspaceId) });
    },
  });
}

export function useTransferResearchMaterials(runId: string, paperWorkspaceId: string, workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { sourceIds?: string[]; claimIds?: string[]; evidenceIds?: string[] }) => (await fetchJson<{ transfer: unknown }>(`/api/research/runs/${runId}/transfer`, { method: "POST", body: JSON.stringify({ paperWorkspaceId, ...input }) })).transfer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.research.run(runId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.papers.workspace(paperWorkspaceId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.research.workspace(workspaceId) });
    },
  });
}

export function useUpdateResearchClaim(runId: string, workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { claimId: string; statement: string }) => (await fetchJson<{ claim: unknown }>(`/api/research/runs/${runId}/claims/${input.claimId}`, { method: "PATCH", body: JSON.stringify({ statement: input.statement }) })).claim,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.research.run(runId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.research.workspace(workspaceId) });
    },
  });
}

export function useReassessResearchClaim(runId: string, workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (claimId: string) => fetchJson<{ sourceRunId: string; followUpRun: { id: string; status: string; followUpOfId: string | null } | null; resumed: boolean }>(`/api/research/runs/${runId}/claims/${claimId}/reassess`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.research.run(runId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.research.workspace(workspaceId) });
    },
  });
}

export function useUpsertClaimEvidenceRelation(runId: string, workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { claimId: string; evidenceId: string; relation: "supports" | "contradicts" | "qualifies" | "context"; confidence?: number; rationale?: string }) => (await fetchJson<{ relation: unknown }>(`/api/research/runs/${runId}/claims/${input.claimId}/relations`, { method: "POST", body: JSON.stringify(input) })).relation,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.research.run(runId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.research.workspace(workspaceId) });
    },
  });
}
