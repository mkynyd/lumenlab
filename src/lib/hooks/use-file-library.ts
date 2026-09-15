"use client";

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api/client";
import type {
  FileLibraryMimeGroup,
  FileLibraryPage,
  FileLibrarySort,
  FileLibraryStatus,
} from "@/lib/api/types";
import { queryKeys } from "@/lib/query-keys";

export interface FileLibraryFilters {
  q?: string;
  projectId?: string;
  category?: string;
  mimeGroup?: FileLibraryMimeGroup;
  status?: FileLibraryStatus;
  sort?: FileLibrarySort;
}

export const FILE_LIBRARY_PAGE_SIZE = 30;

function buildSearch(
  filters: FileLibraryFilters,
  cursor: string | null
): string {
  const params = new URLSearchParams();
  const q = filters.q?.trim();
  if (q) params.set("q", q);
  if (filters.projectId) params.set("projectId", filters.projectId);
  if (filters.category) params.set("category", filters.category);
  if (filters.mimeGroup) params.set("mimeGroup", filters.mimeGroup);
  if (filters.status) params.set("status", filters.status);
  if (filters.sort) params.set("sort", filters.sort);
  params.set("limit", String(FILE_LIBRARY_PAGE_SIZE));
  if (cursor) params.set("cursor", cursor);
  return params.toString();
}

/**
 * 筛选条件本身（不含游标）就是查询键：改了筛选就是换一份数据，
 * 分页游标交给 `useInfiniteQuery` 的 pageParam，避免两者互相覆盖。
 */
export function fileLibrarySearchKey(filters: FileLibraryFilters): string {
  return buildSearch(filters, null);
}

export function useFileLibrary(filters: FileLibraryFilters) {
  return useInfiniteQuery({
    queryKey: queryKeys.files.library(fileLibrarySearchKey(filters)),
    queryFn: ({ pageParam }) =>
      fetchJson<FileLibraryPage>(
        `/api/files?${buildSearch(filters, pageParam)}`
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}

/** 重新解析：解析是异步跑完的，失效查询让列表自行刷新到最新状态。 */
export function useReparseLibraryFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (fileId: string) =>
      fetchJson<{ success: boolean }>(`/api/files/${fileId}/parse`, {
        method: "POST",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["files"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

/** 删除后让资料页与项目侧栏的文件列表一起失效。 */
export function useDeleteLibraryFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (fileId: string) =>
      fetchJson<{ success: boolean }>(`/api/files/${fileId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["files"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}
