"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchJson } from "@/lib/api/client";
import {
  createIdempotencyKey,
  learningKeys,
  learningUrls,
  type LearningErrorTypeCorrectionDto,
  type LearningHistoryDto,
} from "@/lib/hooks/use-learning-api";
import type { LearningErrorType } from "@/lib/learning/contracts";

export function useLearningHistory(projectId?: string, goalId?: string) {
  return useQuery({
    queryKey: learningKeys.history(projectId || "", goalId || ""),
    queryFn: async () =>
      (
        await fetchJson<{ history: LearningHistoryDto }>(
          learningUrls.history(projectId || "", goalId || "")
        )
      ).history,
    enabled: Boolean(projectId) && Boolean(goalId),
  });
}
export interface CorrectLearningErrorTypeVariables {
  evaluationId: string;
  errorType: LearningErrorType;
  reason?: string | null;
  idempotencyKey?: string;
}

export function useCorrectLearningErrorType(
  projectId: string,
  goalId: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: CorrectLearningErrorTypeVariables) =>
      fetchJson<{ correction: LearningErrorTypeCorrectionDto }>(
        learningUrls.errorTypeCorrections(
          projectId,
          goalId,
          variables.evaluationId
        ),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            errorType: variables.errorType,
            ...(variables.reason === undefined
              ? {}
              : { reason: variables.reason }),
            idempotencyKey:
              variables.idempotencyKey ?? createIdempotencyKey(),
          }),
        }
      ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: learningKeys.history(projectId, goalId),
        }),
        queryClient.invalidateQueries({
          queryKey: learningKeys.wrongAnswers(projectId, goalId),
        }),
      ]);
    },
  });
}
