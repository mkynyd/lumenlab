"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api/client";
import { createIdempotencyKey, learningKeys, learningUrls } from "@/lib/hooks/use-learning-api";
import type {
  CreateGoalInput,
  KnowledgeMapDto,
  LearningGoalDto,
  LearningScopeDto,
  SaveScopeDraftInput,
} from "@/lib/hooks/use-learning-api";

export type CreateLearningGoalVariables = CreateGoalInput & {
  idempotencyKey?: string;
};

export type UpdateLearningGoalStatusVariables = {
  status: LearningGoalDto["status"];
  idempotencyKey?: string;
};

export type SaveScopeDraftVariables = SaveScopeDraftInput & {
  idempotencyKey?: string;
};

export type ConfirmScopeVariables = {
  expectedVersion: number;
  idempotencyKey?: string;
};

export function useLearningGoals(projectId?: string) {
  return useQuery({
    queryKey: learningKeys.goals(projectId || ""),
    queryFn: async () =>
      (
        await fetchJson<{ goals: LearningGoalDto[] }>(
          learningUrls.goals(projectId || "")
        )
      ).goals,
    enabled: Boolean(projectId),
  });
}

export function useCreateLearningGoal(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateLearningGoalVariables) =>
      fetchJson<{ goal: LearningGoalDto }>(learningUrls.goals(projectId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...input,
          activate: input.activate ?? true,
          idempotencyKey: input.idempotencyKey ?? createIdempotencyKey(),
        }),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: learningKeys.goals(projectId),
      }),
  });
}

export function useUpdateLearningGoalStatus(projectId: string, goalId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: UpdateLearningGoalStatusVariables) =>
      fetchJson<{ goal: LearningGoalDto }>(learningUrls.goal(projectId, goalId), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: variables.status,
          idempotencyKey: variables.idempotencyKey ?? createIdempotencyKey(),
        }),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: learningKeys.goals(projectId),
      }),
  });
}

export function useDeleteLearningGoal(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (goalId: string) =>
      fetchJson<{ success: boolean }>(learningUrls.goal(projectId, goalId), {
        method: "DELETE",
      }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: learningKeys.goals(projectId),
        }),
        queryClient.invalidateQueries({
          queryKey: learningKeys.today(),
        }),
      ]),
  });
}

export function useLearningScope(projectId?: string, goalId?: string) {
  return useQuery({
    queryKey: learningKeys.scope(projectId || "", goalId || ""),
    queryFn: async () =>
      (
        await fetchJson<{ scope: LearningScopeDto | null }>(
          learningUrls.scope(projectId || "", goalId || "")
        )
      ).scope,
    enabled: Boolean(projectId) && Boolean(goalId),
  });
}

export function useSaveScopeDraft(projectId: string, goalId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveScopeDraftVariables) =>
      fetchJson<{ scope: LearningScopeDto }>(learningUrls.scope(projectId, goalId), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: "replace_draft",
          ...input,
          idempotencyKey: input.idempotencyKey ?? createIdempotencyKey(),
        }),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: learningKeys.scope(projectId, goalId),
      }),
  });
}

export function useConfirmScope(projectId: string, goalId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: ConfirmScopeVariables) =>
      fetchJson<{ scope: LearningScopeDto }>(learningUrls.scope(projectId, goalId), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: "confirm",
          expectedVersion: variables.expectedVersion,
          idempotencyKey: variables.idempotencyKey ?? createIdempotencyKey(),
        }),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: learningKeys.scope(projectId, goalId),
      }),
  });
}

export function useKnowledgeMap(projectId?: string, goalId?: string) {
  return useQuery({
    queryKey: learningKeys.map(projectId || "", goalId || ""),
    queryFn: async () =>
      (
        await fetchJson<{ map: KnowledgeMapDto | null }>(
          learningUrls.map(projectId || "", goalId || "")
        )
      ).map,
    enabled: Boolean(projectId) && Boolean(goalId),
  });
}

export function useGenerateKnowledgeMap(projectId: string, goalId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: { idempotencyKey?: string }) =>
      fetchJson<{ map: KnowledgeMapDto }>(learningUrls.map(projectId, goalId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: variables.idempotencyKey ?? createIdempotencyKey(),
        }),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(learningKeys.map(projectId, goalId), data.map);
    },
  });
}
