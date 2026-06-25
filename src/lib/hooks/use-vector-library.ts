"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api/client";
import type { VectorLibraryGraph } from "@/lib/api/types";
import { queryKeys } from "@/lib/query-keys";

export function useVectorLibrary(
  projectId: string | undefined,
  { enabled = true }: { enabled?: boolean } = {}
) {
  return useQuery<VectorLibraryGraph>({
    queryKey: queryKeys.projects.vectorLibrary(projectId || ""),
    queryFn: async () => {
      const response = await fetchJson<{ graph: VectorLibraryGraph }>(
        `/api/projects/${projectId}/vector-library`
      );
      return response.graph;
    },
    enabled: Boolean(projectId) && enabled,
    staleTime: 60_000,
  });
}
