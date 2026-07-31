"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api/client";
import { createIdempotencyKey, learningKeys, learningUrls } from "@/lib/hooks/use-learning-api";
import type {
  LearningProgressResponse,
  LearningSessionClientDto,
  ReviewEntryDto,
  ReviewListResponse,
  WrongAnswerListResponse,
} from "@/lib/hooks/use-learning-api";

export type CreateReviewSessionVariables = {
  limit?: number;
  idempotencyKey?: string;
};

export function useLearningProgress(projectId?: string, goalId?: string) {
  return useQuery({
    queryKey: learningKeys.progress(projectId || "", goalId || ""),
    queryFn: () =>
      fetchJson<LearningProgressResponse>(
        learningUrls.progress(projectId || "", goalId || "")
      ),
    enabled: Boolean(projectId) && Boolean(goalId),
  });
}

export function useWrongAnswers(projectId?: string, goalId?: string) {
  return useQuery({
    queryKey: learningKeys.wrongAnswers(projectId || "", goalId || ""),
    queryFn: async () =>
      (
        await fetchJson<WrongAnswerListResponse>(
          learningUrls.wrongAnswers(projectId || "", goalId || "")
        )
      ).items,
    enabled: Boolean(projectId) && Boolean(goalId),
  });
}

export function useReviewQueue(projectId?: string, goalId?: string) {
  return useQuery({
    queryKey: learningKeys.reviews(projectId || "", goalId || ""),
    queryFn: async (): Promise<ReviewEntryDto[]> =>
      (
        await fetchJson<ReviewListResponse>(
          learningUrls.reviews(projectId || "", goalId || "")
        )
      ).reviews,
    enabled: Boolean(projectId) && Boolean(goalId),
  });
}

export function useCreateReviewSession(projectId: string, goalId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: CreateReviewSessionVariables) =>
      fetchJson<{ session: LearningSessionClientDto }>(
        learningUrls.reviews(projectId, goalId),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idempotencyKey: variables.idempotencyKey ?? createIdempotencyKey(),
            ...(variables.limit !== undefined ? { limit: variables.limit } : {}),
          }),
        }
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: learningKeys.reviews(projectId, goalId),
      }),
  });
}
