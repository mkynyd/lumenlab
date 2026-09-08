"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";

export interface FormattingTaskSummary {
  id: string;
  title: string;
  originalName: string;
  status: string;
  stage: string;
  attempt: number;
  completedUnits: number;
  totalUnits: number | null;
  documentId: string | null;
  compilationId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  canCancel: boolean;
  canRetry: boolean;
  sourcePath: string;
}

export interface FormattingTemplateVariant {
  id: string;
  variantKey: string;
  adapterId: string;
  canSubmit: boolean;
  reason: string | null;
  verified: boolean;
  hasLatex: boolean;
  requiredMetadata: string[];
  sampleAvailable: boolean;
}

export interface FormattingTemplateRecord {
  id: string;
  university: string;
  degreeType: string | null;
  year: string | null;
  format: string;
  repositoryUrl: string | null;
  officialSpecUrl: string | null;
  status: string;
  variants: FormattingTemplateVariant[];
}

export interface FormattingReviewBlock {
  blockId: string;
  kind: string;
  title: string;
  characters: number;
}

export interface FormattingRole {
  blockId: string;
  role: "keep" | "heading" | "abstract_zh" | "abstract_en" | "acknowledgement";
  level?: number;
  confidence: number;
}

export interface FormattingReview {
  blocks: FormattingReviewBlock[];
  roles: FormattingRole[];
  warnings: Array<{ index?: number; reason?: string }>;
}

export function useFormattingTasks() {
  return useQuery({
    queryKey: queryKeys.papers.formattingTasks,
    queryFn: async () => (await fetchJson<{ tasks: FormattingTaskSummary[] }>("/api/papers/formatting")).tasks,
  });
}

export function useFormattingTask(id: string | null) {
  return useQuery({
    queryKey: queryKeys.papers.formattingTask(id ?? "none"),
    enabled: Boolean(id),
    queryFn: async () => fetchJson<{ task: FormattingTaskSummary; review: FormattingReview | null }>(`/api/papers/formatting/${id}`),
    refetchInterval: (query) => (query.state.data?.task.canCancel ? 4_000 : false),
  });
}

export function useFormattingTemplates(query: string) {
  return useQuery({
    queryKey: queryKeys.papers.formattingTemplates(query),
    queryFn: async () => fetchJson<{ templates: FormattingTemplateRecord[]; counts: { records: number; variants: number; latex: number; verified: number; submittable: number } }>(`/api/papers/formatting/templates?q=${encodeURIComponent(query)}`),
  });
}

export function useSubmitFormatting() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { file: File; submission: { requestKey: string; templateVariantId: string; metadata: Record<string, unknown> } }) => {
      const body = new FormData();
      body.set("file", input.file);
      body.set("submission", JSON.stringify(input.submission));
      return (await fetchJson<{ task: FormattingTaskSummary }>("/api/papers/formatting", { method: "POST", body })).task;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.papers.formattingTasks }),
  });
}

function useFormattingAction(id: string, action: "cancel" | "retry") {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => (await fetchJson<{ task: FormattingTaskSummary }>(`/api/papers/formatting/${id}/${action}`, { method: "POST" })).task,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.papers.formattingTask(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.papers.formattingTasks });
    },
  });
}

export const useCancelFormatting = (id: string) => useFormattingAction(id, "cancel");
export const useRetryFormatting = (id: string) => useFormattingAction(id, "retry");

export function useConfirmFormatting(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (roles: FormattingRole[]) => (await fetchJson<{ task: FormattingTaskSummary }>(`/api/papers/formatting/${id}/confirm`, { method: "POST", body: JSON.stringify({ confirmed: true, roles }) })).task,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.papers.formattingTask(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.papers.formattingTasks });
    },
  });
}
