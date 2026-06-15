"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { fetchJson } from "@/lib/api/client";
import type { ProjectDetail, ProjectSummary } from "@/lib/api/types";
import { queryKeys } from "@/lib/query-keys";

export interface CreateProjectInput {
  name: string;
  description?: string;
  type: "experiment" | "review" | "coding" | "general";
  defaultModel?: string;
}

export function useProjects() {
  return useQuery({
    queryKey: queryKeys.projects.all,
    queryFn: async () =>
      (await fetchJson<{ projects: ProjectSummary[] }>("/api/projects"))
        .projects,
  });
}

export function useProject(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.projects.detail(id || ""),
    queryFn: async () =>
      (
        await fetchJson<{ project: ProjectDetail }>(`/api/projects/${id}`)
      ).project,
    enabled: Boolean(id),
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProjectInput) =>
      fetchJson<{ project: ProjectDetail }>("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    onSuccess: ({ project }) => {
      queryClient.setQueryData(
        queryKeys.projects.detail(project.id),
        project
      );
      return queryClient.invalidateQueries({
        queryKey: queryKeys.projects.all,
      });
    },
  });
}

export function useDeleteProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetchJson<{ success: true }>(`/api/projects/${id}`, {
        method: "DELETE",
      }),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.projects.all });
      const previous = queryClient.getQueryData<ProjectSummary[]>(
        queryKeys.projects.all
      );
      queryClient.setQueryData<ProjectSummary[]>(
        queryKeys.projects.all,
        (current = []) => current.filter((item) => item.id !== id)
      );
      return { previous };
    },
    onError: (_error, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.projects.all, context.previous);
      }
    },
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: queryKeys.projects.detail(id) });
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.all }),
  });
}
