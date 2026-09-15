"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CloudUpload, Page, Search, Filter } from "iconoir-react";
import { Button } from "@/components/ui/button";
import { FileUploadDialog } from "@/components/files/file-upload-dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileLibraryRow } from "@/components/files/file-library-row";
import { FileDetailDialog } from "@/components/files/file-detail-dialog";
import { FILE_CATEGORIES } from "@/lib/file-categories";
import {
  fileLibrarySearchKey,
  useDeleteLibraryFile,
  useFileLibrary,
  useReparseLibraryFile,
  type FileLibraryFilters,
} from "@/lib/hooks/use-file-library";
import { useProjects } from "@/lib/hooks/use-projects";
import { errorMessage } from "@/lib/api/client";
import type {
  FileLibraryItem,
  FileLibraryMimeGroup,
  FileLibrarySort,
  FileLibraryStatus,
} from "@/lib/api/types";
import { cn } from "@/lib/utils";

const MIME_GROUP_LABELS: Record<FileLibraryMimeGroup, string> = {
  document: "文档",
  image: "图片",
  video: "视频",
  text: "文本",
  data: "数据",
  code: "代码",
};

const STATUS_LABELS: Record<FileLibraryStatus, string> = {
  parsing: "解析中",
  parsed: "已解析",
  warning: "有警告",
  "index-incomplete": "索引不完整",
  failed: "解析失败",
};

const SORT_LABELS: Record<FileLibrarySort, string> = {
  relevance: "相关度",
  recent: "最近更新",
  name: "文件名",
};

const SEARCH_DEBOUNCE_MS = 200;
const ALL = "__all__";
const EMPTY_SELECTION: ReadonlySet<string> = new Set<string>();

function isMimeGroup(value: string | null): value is FileLibraryMimeGroup {
  return value !== null && value in MIME_GROUP_LABELS;
}

function isStatus(value: string | null): value is FileLibraryStatus {
  return value !== null && value in STATUS_LABELS;
}

function isSort(value: string | null): value is FileLibrarySort {
  return value !== null && value in SORT_LABELS;
}

export function FileLibraryView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const urlQuery = searchParams.get("q") ?? "";
  const projectId = searchParams.get("projectId") ?? undefined;
  const category = searchParams.get("category") ?? undefined;
  const mimeGroupParam = searchParams.get("mimeGroup");
  const statusParam = searchParams.get("status");
  const sortParam = searchParams.get("sort");
  const mimeGroup = isMimeGroup(mimeGroupParam) ? mimeGroupParam : undefined;
  const status = isStatus(statusParam) ? statusParam : undefined;
  const explicitSort = isSort(sortParam) ? sortParam : undefined;
  // 没手动选过排序时：有关键词按相关度，否则按最近更新。
  const effectiveSort: FileLibrarySort =
    explicitSort ?? (urlQuery.trim() ? "relevance" : "recent");

  const [searchInput, setSearchInput] = useState(urlQuery);
  const [previewFile, setPreviewFile] = useState<FileLibraryItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FileLibraryItem | null>(null);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // URL 是筛选的真源：返回键或外部跳转会同步回输入框。这是「外部值变了就调整
  // state」的场景，放在渲染期比较即可，不必用 effect 多跑一轮级联渲染。
  const [syncedUrlQuery, setSyncedUrlQuery] = useState(urlQuery);
  if (syncedUrlQuery !== urlQuery) {
    setSyncedUrlQuery(urlQuery);
    setSearchInput(urlQuery);
  }

  const updateParams = useCallback(
    (patch: Record<string, string | undefined>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  useEffect(() => {
    if (searchInput === urlQuery) return;
    const timer = setTimeout(() => {
      updateParams({ q: searchInput.trim() || undefined });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput, urlQuery, updateParams]);

  const filters = useMemo<FileLibraryFilters>(
    () => ({
      q: urlQuery || undefined,
      projectId,
      category,
      mimeGroup,
      status,
      sort: effectiveSort,
    }),
    [urlQuery, projectId, category, mimeGroup, status, effectiveSort]
  );

  const query = useFileLibrary(filters);
  const files = useMemo(
    () => query.data?.pages.flatMap((page) => page.files) ?? [],
    [query.data]
  );
  const projectsQuery = useProjects();
  const deleteMutation = useDeleteLibraryFile();
  const reparseMutation = useReparseLibraryFile();

  // 选择与筛选条件绑定：条件一变旧集合自动作废，避免批量删除连带删掉屏幕上
  // 已经看不到的文件，同时不需要在 effect 里清空 state。
  const filterKey = fileLibrarySearchKey(filters);
  const [selection, setSelection] = useState<{ key: string; ids: Set<string> }>({
    key: filterKey,
    ids: new Set<string>(),
  });
  const selectedIds =
    selection.key === filterKey ? selection.ids : EMPTY_SELECTION;

  function toggleSelected(file: FileLibraryItem, selected: boolean) {
    setSelection((current) => {
      const ids = new Set(
        current.key === filterKey ? current.ids : EMPTY_SELECTION
      );
      if (selected) ids.add(file.id);
      else ids.delete(file.id);
      return { key: filterKey, ids };
    });
  }

  const hasActiveFilters = Boolean(
    urlQuery || projectId || category || mimeGroup || status
  );

  function clearFilters() {
    setSearchInput("");
    router.replace(pathname, { scroll: false });
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    await deleteMutation.mutateAsync(deleteTarget.id).catch(() => {});
    setDeleteTarget(null);
  }

  /**
   * 批量导出走同源 POST，拿到 zip 后用 blob 下载：不把文件 id 拼进 GET URL，
   * 也避免批量选择多时超出 URL 长度。
   */
  async function exportSelected() {
    if (selectedIds.size === 0 || exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      const response = await fetch("/api/files/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileIds: [...selectedIds] }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(errorMessage(payload, "导出失败，请稍后重试"));
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "资料导出.zip";
      link.click();
      URL.revokeObjectURL(url);
    } catch (exportFailure) {
      setExportError(
        exportFailure instanceof Error ? exportFailure.message : "导出失败，请稍后重试"
      );
    } finally {
      setExporting(false);
    }
  }

  async function confirmBatchDelete() {
    const ids = [...selectedIds];
    setBatchDeleteOpen(false);
    for (const id of ids) {
      await deleteMutation.mutateAsync(id).catch(() => {});
    }
    setSelection({ key: filterKey, ids: new Set<string>() });
  }

  const activeFilterCount = [projectId, category, mimeGroup, status].filter(
    Boolean
  ).length;

  /**
   * 筛选控件在桌面横向排列、在移动端收进底部抽屉，两处共用同一份 JSX，
   * 只把宽度策略交给调用方，避免出现两套筛选逻辑。
   */
  function renderFilterSelects(triggerClassName: string) {
    return (
      <>
        <Select
          value={projectId ?? ALL}
          onValueChange={(value) =>
            updateParams({ projectId: value === ALL ? undefined : value })
          }
        >
          <SelectTrigger className={triggerClassName} aria-label="按项目筛选">
            <SelectValue placeholder="全部项目" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>全部项目</SelectItem>
            {(projectsQuery.data ?? []).map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={category ?? ALL}
          onValueChange={(value) =>
            updateParams({ category: value === ALL ? undefined : value })
          }
        >
          <SelectTrigger className={triggerClassName} aria-label="按分类筛选">
            <SelectValue placeholder="全部分类" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>全部分类</SelectItem>
            {FILE_CATEGORIES.map((item) => (
              <SelectItem key={item} value={item}>
                {item}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={mimeGroup ?? ALL}
          onValueChange={(value) =>
            updateParams({ mimeGroup: value === ALL ? undefined : value })
          }
        >
          <SelectTrigger className={triggerClassName} aria-label="按类型筛选">
            <SelectValue placeholder="全部类型" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>全部类型</SelectItem>
            {Object.entries(MIME_GROUP_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={status ?? ALL}
          onValueChange={(value) =>
            updateParams({ status: value === ALL ? undefined : value })
          }
        >
          <SelectTrigger className={triggerClassName} aria-label="按状态筛选">
            <SelectValue placeholder="全部状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>全部状态</SelectItem>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={effectiveSort}
          onValueChange={(value) => updateParams({ sort: value })}
        >
          <SelectTrigger className={triggerClassName} aria-label="排序方式">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="relevance" disabled={!urlQuery.trim()}>
              相关度
            </SelectItem>
            <SelectItem value="recent">最近更新</SelectItem>
            <SelectItem value="name">文件名</SelectItem>
          </SelectContent>
        </Select>
      </>
    );
  }

  const filterSelectClass =
    "h-8 w-auto min-w-[6.5rem] rounded-full bg-[var(--color-project-control)] text-xs";

  return (
    <div className="h-full overflow-y-auto bg-[var(--color-bg)]">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-[-0.02em] text-[var(--color-text-primary)]">
              资料
            </h1>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
              跨项目找到、核对并使用你上传的每一份资料
            </p>
          </div>
          <FileUploadDialog
            trigger={
              <Button
                variant="primary"
                size="sm"
                className="bg-[var(--color-project-action)] text-[var(--color-project-action-contrast)] hover:bg-[var(--color-project-action-hover)] focus-visible:bg-[var(--color-project-action-hover)]"
              >
                <CloudUpload width={16} height={16} strokeWidth={2} />
                上传
              </Button>
            }
          />
        </div>

        {exportError && (
          <p role="alert" className="mb-3 text-xs text-[var(--color-error)]">
            {exportError}
          </p>
        )}

        <div className="mb-3 flex items-center gap-2 rounded-full bg-[var(--color-project-control)] px-3 py-2">
          <Search
            width={16}
            height={16}
            strokeWidth={1.8}
            className="shrink-0 text-[var(--color-text-tertiary)]"
          />
          <input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            type="search"
            placeholder="搜索文件名、项目或解析内容"
            aria-label="搜索资料"
            className="min-w-0 flex-1 bg-transparent text-sm text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => setSearchInput("")}
              className="shrink-0 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
            >
              清除
            </button>
          )}
        </div>

        {/* 桌面：筛选横向排列 */}
        <div className="mb-4 hidden flex-wrap items-center gap-2 sm:flex">
          {renderFilterSelects(filterSelectClass)}
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="h-8 rounded-full text-xs text-[var(--color-text-secondary)]"
            >
              清除筛选
            </Button>
          )}

          <span className="flex-1" />

          {selectedIds.size > 0 && (
            <>
              <Button
                variant="ghost"
                size="sm"
                disabled={exporting}
                onClick={() => void exportSelected()}
                className="h-8 rounded-full text-xs text-[var(--color-text-secondary)]"
              >
                {exporting ? "导出中…" : `导出解析内容 ${selectedIds.size} 项`}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setBatchDeleteOpen(true)}
                className="h-8 rounded-full text-xs text-[var(--color-error)]"
              >
                删除所选 {selectedIds.size} 项
              </Button>
            </>
          )}
        </div>

        {/* 移动端：筛选收进底部抽屉，列表只保留必要信息 */}
        <div className="mb-4 flex items-center gap-2 sm:hidden">
          <Sheet>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 rounded-full bg-[var(--color-project-control)] px-3 text-xs text-[var(--color-text-secondary)]"
              >
                <Filter width={15} height={15} strokeWidth={1.8} />
                筛选{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ""}
              </Button>
            </SheetTrigger>
            <SheetContent side="bottom" className="rounded-t-[var(--radius-lg)]">
              <SheetHeader>
                <SheetTitle>筛选资料</SheetTitle>
              </SheetHeader>
              <div className="flex flex-col gap-3 px-4 pb-6 pt-2">
                {renderFilterSelects(
                  "h-10 w-full rounded-[var(--radius-md)] bg-[var(--color-project-control)] text-sm"
                )}
              </div>
            </SheetContent>
          </Sheet>

          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="h-8 rounded-full text-xs text-[var(--color-text-secondary)]"
            >
              清除
            </Button>
          )}

          <span className="flex-1" />

          {selectedIds.size > 0 && (
            <>
              <Button
                variant="ghost"
                size="sm"
                disabled={exporting}
                onClick={() => void exportSelected()}
                className="h-8 rounded-full text-xs text-[var(--color-text-secondary)]"
              >
                {exporting ? "导出中…" : `导出解析内容 ${selectedIds.size} 项`}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setBatchDeleteOpen(true)}
                className="h-8 rounded-full text-xs text-[var(--color-error)]"
              >
                删除所选 {selectedIds.size} 项
              </Button>
            </>
          )}
        </div>

        <p aria-live="polite" className="sr-only">
          {query.isLoading
            ? "正在加载资料"
            : `共 ${files.length} 个${hasActiveFilters ? "匹配" : ""}结果`}
        </p>

        {query.isLoading ? (
          <div className="space-y-1" aria-hidden>
            {[1, 2, 3, 4].map((index) => (
              <div
                key={index}
                className="h-14 animate-pulse rounded-[var(--radius-md)] bg-[var(--color-project-control)]"
              />
            ))}
          </div>
        ) : query.isError ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <h2 className="mb-1 text-base font-medium text-[var(--color-text-primary)]">
              资料加载失败
            </h2>
            <p className="mb-5 text-sm text-[var(--color-text-tertiary)]">
              网络或服务暂时不可用，稍后再试。
            </p>
            <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
              重试
            </Button>
          </div>
        ) : files.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Page
              width={26}
              height={26}
              strokeWidth={1.5}
              className="mb-4 text-[var(--color-text-tertiary)]"
            />
            <h2 className="mb-1 text-base font-medium text-[var(--color-text-primary)]">
              {hasActiveFilters ? "没有匹配的资料" : "还没有上传任何资料"}
            </h2>
            <p className="mb-5 text-sm text-[var(--color-text-tertiary)]">
              {hasActiveFilters
                ? "换个关键词，或清除筛选条件重新查看。"
                : "在任意项目里上传资料后，都会汇总到这里。"}
            </p>
            {hasActiveFilters && (
              <Button variant="secondary" size="sm" onClick={clearFilters}>
                清除筛选
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className="space-y-0.5" role="list">
              {files.map((file) => (
                <FileLibraryRow
                  key={file.id}
                  file={file}
                  query={urlQuery || undefined}
                  selected={selectedIds.has(file.id)}
                  onSelectedChange={toggleSelected}
                  onPreview={setPreviewFile}
                  onReparse={(target) => reparseMutation.mutate(target.id)}
                  onDelete={setDeleteTarget}
                />
              ))}
            </div>

            {query.hasNextPage && (
              <div className="mt-4 flex justify-center">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={query.isFetchingNextPage}
                  onClick={() => void query.fetchNextPage()}
                >
                  {query.isFetchingNextPage ? "加载中…" : "加载更多"}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {previewFile && (
        <FileDetailDialog
          file={previewFile}
          onClose={() => setPreviewFile(null)}
          onChanged={() => void query.refetch()}
        />
      )}

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除这份资料？</AlertDialogTitle>
            <AlertDialogDescription>
              「{deleteTarget?.originalName}」的原件、解析内容与检索分块都会被移除，无法恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDelete()}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={batchDeleteOpen} onOpenChange={setBatchDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              删除所选的 {selectedIds.size} 份资料？
            </AlertDialogTitle>
            <AlertDialogDescription>
              原件、解析内容与检索分块都会被移除，无法恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void confirmBatchDelete()}
              className={cn("bg-[var(--color-error)] text-white")}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
