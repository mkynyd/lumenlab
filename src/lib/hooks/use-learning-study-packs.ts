"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchJson } from "@/lib/api/client";
import {
  createIdempotencyKey,
  learningKeys,
  learningUrls,
  type StudyPackDto,
  type StudyPackOutlineItemDto,
  type StudyPackSectionDto,
} from "@/lib/hooks/use-learning-api";

export function useStudyPacks(projectId?: string, goalId?: string) {
  return useQuery({
    queryKey: learningKeys.studyPacks(projectId || "", goalId || ""),
    queryFn: async () =>
      (
        await fetchJson<{ packs: StudyPackDto[] }>(
          learningUrls.studyPacks(projectId || "", goalId || "")
        )
      ).packs,
    enabled: Boolean(projectId) && Boolean(goalId),
  });
}

export function useStudyPack(projectId: string, packId?: string) {
  return useQuery({
    queryKey: learningKeys.studyPack(projectId, packId || ""),
    queryFn: async () =>
      (
        await fetchJson<{ pack: StudyPackDto }>(
          learningUrls.studyPack(projectId, packId || "")
        )
      ).pack,
    enabled: Boolean(packId),
  });
}

export interface CreateStudyPackVariables {
  title?: string;
  idempotencyKey?: string;
}

export function useCreateStudyPack(projectId: string, goalId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: CreateStudyPackVariables) =>
      fetchJson<{ pack: StudyPackDto }>(
        learningUrls.studyPacks(projectId, goalId),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(variables.title === undefined
              ? {}
              : { title: variables.title }),
            idempotencyKey:
              variables.idempotencyKey ?? createIdempotencyKey(),
          }),
        }
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: learningKeys.studyPacks(projectId, goalId),
      });
    },
  });
}

export interface UpdateStudyPackOutlineVariables {
  outline: StudyPackOutlineItemDto[];
  status?: "draft" | "confirmed";
  idempotencyKey?: string;
}

export function useUpdateStudyPackOutline(projectId: string, packId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: UpdateStudyPackOutlineVariables) =>
      fetchJson<{ pack: StudyPackDto }>(
        learningUrls.studyPackOutline(projectId, packId),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            outline: variables.outline,
            ...(variables.status === undefined
              ? {}
              : { status: variables.status }),
            ...(variables.idempotencyKey === undefined
              ? {}
              : { idempotencyKey: variables.idempotencyKey }),
          }),
        }
      ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: learningKeys.studyPack(projectId, packId),
        }),
        queryClient.invalidateQueries({
          queryKey: learningKeys.studyPacks(projectId, ""),
        }),
      ]);
    },
  });
}

export function useGenerateStudyPack(projectId: string, packId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      fetchJson<{
        pack: StudyPackDto;
        generated: number;
        skipped: number;
      }>(learningUrls.studyPackGenerate(projectId, packId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: createIdempotencyKey(),
        }),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: learningKeys.studyPack(projectId, packId),
        }),
        queryClient.invalidateQueries({
          queryKey: learningKeys.studyPacks(projectId, ""),
        }),
      ]);
    },
  });
}

export interface SaveStudyPackSectionVariables {
  sectionId: string;
  content: string;
  idempotencyKey?: string;
}

export function useSaveStudyPackSection(projectId: string, packId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: SaveStudyPackSectionVariables) =>
      fetchJson<{ section: StudyPackSectionDto }>(
        learningUrls.studyPackSection(
          projectId,
          packId,
          variables.sectionId
        ),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: variables.content,
            ...(variables.idempotencyKey === undefined
              ? {}
              : { idempotencyKey: variables.idempotencyKey }),
          }),
        }
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: learningKeys.studyPack(projectId, packId),
      });
    },
  });
}

export function useRegenerateStudyPackSection(
  projectId: string,
  packId: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sectionId: string) =>
      fetchJson<{ section: StudyPackSectionDto }>(
        learningUrls.studyPackSectionRegenerate(projectId, packId, sectionId),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idempotencyKey: createIdempotencyKey(),
          }),
        }
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: learningKeys.studyPack(projectId, packId),
      });
    },
  });
}

export function usePublishStudyPack(projectId: string, packId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      fetchJson<{
        pack: StudyPackDto;
        artifact: { id: string; title: string };
      }>(learningUrls.studyPackPublish(projectId, packId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: createIdempotencyKey(),
        }),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: learningKeys.studyPack(projectId, packId),
        }),
        queryClient.invalidateQueries({
          queryKey: learningKeys.studyPacks(projectId, ""),
        }),
      ]);
    },
  });
}
