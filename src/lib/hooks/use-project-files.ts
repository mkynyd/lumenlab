"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api/client";
import type { ProjectFile } from "@/lib/api/types";
import { queryKeys } from "@/lib/query-keys";
import type { FileCategory } from "@/lib/file-categories";

export function useProjectFiles(
  projectId: string | undefined,
  initialData?: ProjectFile[]
) {
  return useQuery({
    queryKey: queryKeys.projects.files(projectId || ""),
    queryFn: async () =>
      (
        await fetchJson<{ files: ProjectFile[] }>(
          `/api/projects/${projectId}/files`
        )
      ).files,
    enabled: Boolean(projectId),
    initialData,
  });
}

export function useUploadFile(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      return fetchJson<{ file: ProjectFile; note?: string }>(
        `/api/projects/${projectId}/files`,
        { method: "POST", body: formData }
      );
    },
    onSuccess: ({ file }) => {
      queryClient.setQueryData<ProjectFile[]>(
        queryKeys.projects.files(projectId),
        (current = []) => [file, ...current]
      );
      return Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.projects.files(projectId),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.projects.detail(projectId),
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projects.all }),
      ]);
    },
  });
}

export function useUploadFiles(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { files: File[]; category: FileCategory }) => {
      const formData = new FormData();
      for (const file of input.files) {
        formData.append("files", file);
      }
      formData.append("category", input.category);
      const result = await fetchJson<{
        files: ProjectFile[];
        errors: Array<{ name: string; error: string }>;
        summary: { total: number; succeeded: number; failed: number };
      }>(`/api/projects/${projectId}/files`, {
        method: "POST",
        body: formData,
      });
      return result;
    },
    onSuccess: (result) => {
      queryClient.setQueryData<ProjectFile[]>(
        queryKeys.projects.files(projectId),
        (current = []) => [...result.files, ...current]
      );
      return Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.projects.files(projectId),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.projects.detail(projectId),
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projects.all }),
      ]);
    },
  });
}
