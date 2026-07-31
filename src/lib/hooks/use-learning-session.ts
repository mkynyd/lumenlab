"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api/client";
import { createIdempotencyKey, learningKeys, learningUrls } from "@/lib/hooks/use-learning-api";
import type {
  AnswerExposureResultDto,
  AttemptAnswer,
  AttemptResultDto,
  HintResultDto,
  LearningSessionClientDto,
} from "@/lib/hooks/use-learning-api";

export type RecordHintVariables = {
  sessionItemId: string;
  idempotencyKey?: string;
};

export type RecordAnswerExposureVariables = {
  sessionItemId: string;
  idempotencyKey?: string;
};

export type SubmitAttemptVariables = {
  sessionItemId: string;
  answer: AttemptAnswer;
  goalId?: string;
  idempotencyKey?: string;
};

export function useLearningSession(projectId?: string, sessionId?: string) {
  return useQuery({
    queryKey: learningKeys.session(projectId || "", sessionId || ""),
    queryFn: async () =>
      (
        await fetchJson<{ session: LearningSessionClientDto }>(
          learningUrls.session(projectId || "", sessionId || "")
        )
      ).session,
    enabled: Boolean(projectId) && Boolean(sessionId),
  });
}

export function useCreateDiagnosticSession(projectId: string, goalId: string) {
  return useMutation({
    mutationFn: (variables: { idempotencyKey?: string }) =>
      fetchJson<{ session: LearningSessionClientDto }>(
        learningUrls.diagnostics(projectId, goalId),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idempotencyKey: variables.idempotencyKey ?? createIdempotencyKey(),
          }),
        }
      ),
  });
}

export function useRecordHint(projectId: string, sessionId: string) {
  return useMutation({
    mutationFn: (variables: RecordHintVariables) =>
      fetchJson<HintResultDto>(
        learningUrls.sessionItemHint(projectId, sessionId, variables.sessionItemId),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idempotencyKey: variables.idempotencyKey ?? createIdempotencyKey(),
          }),
        }
      ),
  });
}

export function useRecordAnswerExposure(projectId: string, sessionId: string) {
  return useMutation({
    mutationFn: (variables: RecordAnswerExposureVariables) =>
      fetchJson<AnswerExposureResultDto>(
        learningUrls.sessionItemAnswer(projectId, sessionId, variables.sessionItemId),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idempotencyKey: variables.idempotencyKey ?? createIdempotencyKey(),
          }),
        }
      ),
  });
}

export function useSubmitAttempt(projectId: string, sessionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: SubmitAttemptVariables) =>
      fetchJson<AttemptResultDto>(
        learningUrls.sessionItemAttempts(projectId, sessionId, variables.sessionItemId),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idempotencyKey: variables.idempotencyKey ?? createIdempotencyKey(),
            answer: variables.answer,
          }),
        }
      ),
    onSuccess: (_data, variables) => {
      const invalidations = [
        queryClient.invalidateQueries({
          queryKey: learningKeys.session(projectId, sessionId),
        }),
      ];
      if (variables.goalId) {
        const goalId = variables.goalId;
        invalidations.push(
          queryClient.invalidateQueries({
            queryKey: learningKeys.progress(projectId, goalId),
          }),
          queryClient.invalidateQueries({
            queryKey: learningKeys.wrongAnswers(projectId, goalId),
          }),
          queryClient.invalidateQueries({
            queryKey: learningKeys.reviews(projectId, goalId),
          }),
          queryClient.invalidateQueries({ queryKey: learningKeys.today() })
        );
      }
      return Promise.all(invalidations);
    },
  });
}
