"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchJson } from "@/lib/api/client";
import {
  createIdempotencyKey,
  learningKeys,
  learningUrls,
  type LearningErrorTypeCorrectionDto,
  type LearningGoalDto,
  type LearningGoalRevisionDto,
  type LearningHistoryDto,
  type LearningProfileResetDto,
  type LearningProfileResetScope,
  type LearningProgressDto,
  type LearningRegradeDto,
} from "@/lib/hooks/use-learning-api";
import type {
  EvaluationVerdict,
  LearningErrorType,
} from "@/lib/learning/contracts";

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

export interface RegradeEvaluationVariables {
  evaluationId: string;
  verdict: EvaluationVerdict;
  errorType?: LearningErrorType | null;
  reason: string;
  idempotencyKey?: string;
}

export function useRegradeEvaluation(
  projectId: string,
  goalId: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: RegradeEvaluationVariables) =>
      fetchJson<{
        regrade: LearningRegradeDto;
        progress: LearningProgressDto[];
      }>(
        learningUrls.regrades(projectId, goalId, variables.evaluationId),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            verdict: variables.verdict,
            ...(variables.errorType === undefined
              ? {}
              : { errorType: variables.errorType }),
            reason: variables.reason,
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
          queryKey: learningKeys.progress(projectId, goalId),
        }),
        queryClient.invalidateQueries({
          queryKey: learningKeys.wrongAnswers(projectId, goalId),
        }),
        queryClient.invalidateQueries({
          queryKey: learningKeys.reviews(projectId, goalId),
        }),
        queryClient.invalidateQueries({
          queryKey: learningKeys.today(),
        }),
      ]);
    },
  });
}

export interface ReviseGoalVariables {
  title?: string;
  purpose?: string | null;
  targetDate?: string | null;
  dailyMinutes?: number | null;
  reason: string;
  idempotencyKey?: string;
}

export function useReviseGoal(projectId: string, goalId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: ReviseGoalVariables) =>
      fetchJson<{
        goal: LearningGoalDto;
        revision: LearningGoalRevisionDto;
      }>(learningUrls.revisions(projectId, goalId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(variables.title === undefined ? {} : { title: variables.title }),
          ...(variables.purpose === undefined
            ? {}
            : { purpose: variables.purpose }),
          ...(variables.targetDate === undefined
            ? {}
            : { targetDate: variables.targetDate }),
          ...(variables.dailyMinutes === undefined
            ? {}
            : { dailyMinutes: variables.dailyMinutes }),
          reason: variables.reason,
          idempotencyKey:
            variables.idempotencyKey ?? createIdempotencyKey(),
        }),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: learningKeys.goals(projectId),
        }),
        queryClient.invalidateQueries({
          queryKey: learningKeys.history(projectId, goalId),
        }),
        queryClient.invalidateQueries({
          queryKey: learningKeys.today(),
        }),
      ]);
    },
  });
}

export interface ResetLearningProfileVariables {
  scope: LearningProfileResetScope;
  reason?: string;
  idempotencyKey?: string;
}

export function useResetLearningProfile(
  projectId: string,
  goalId: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: ResetLearningProfileVariables) => {
      const url =
        variables.scope.kind === "user"
          ? learningUrls.userProfileResets()
          : learningUrls.profileResets(projectId, goalId);
      return fetchJson<{ reset: LearningProfileResetDto }>(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: variables.scope,
          ...(variables.reason === undefined
            ? {}
            : { reason: variables.reason }),
          idempotencyKey:
            variables.idempotencyKey ?? createIdempotencyKey(),
        }),
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: learningKeys.history(projectId, goalId),
        }),
        queryClient.invalidateQueries({
          queryKey: learningKeys.progress(projectId, goalId),
        }),
        queryClient.invalidateQueries({
          queryKey: learningKeys.wrongAnswers(projectId, goalId),
        }),
        queryClient.invalidateQueries({
          queryKey: learningKeys.reviews(projectId, goalId),
        }),
        queryClient.invalidateQueries({
          queryKey: learningKeys.today(),
        }),
      ]);
    },
  });
}
