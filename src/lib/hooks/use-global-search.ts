"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api/client";
import type { GlobalSearchResponse } from "@/lib/search/global-search";

export function useGlobalSearch(query: string, enabled: boolean) {
  const normalizedQuery = query.trim();
  return useQuery({
    queryKey: ["global-search", normalizedQuery],
    queryFn: ({ signal }) =>
      fetchJson<GlobalSearchResponse>(
        `/api/search?q=${encodeURIComponent(normalizedQuery)}`,
        { signal }
      ),
    enabled: enabled && normalizedQuery.length > 0,
    staleTime: 30_000,
  });
}
