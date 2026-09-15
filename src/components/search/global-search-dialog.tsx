"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";
import {
  ChatLines,
  Folder,
  MediaImage,
  Search,
  Xmark,
} from "iconoir-react";
import { FileKindIcon } from "@/components/files/file-kind-icon";
import { Spinner } from "@/components/ui/spinner";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useGlobalSearch } from "@/lib/hooks/use-global-search";
import type {
  GlobalSearchResult,
  GlobalSearchResultType,
} from "@/lib/search/global-search";
import { cn } from "@/lib/utils";

type SearchTab = "all" | GlobalSearchResultType;

const TABS: Array<{ id: SearchTab; label: string }> = [
  { id: "all", label: "全部" },
  { id: "conversation", label: "对话" },
  { id: "image", label: "图片" },
  { id: "document", label: "文档" },
  { id: "project", label: "项目" },
];

const TYPE_LABEL: Record<GlobalSearchResultType, string> = {
  conversation: "对话",
  image: "图片",
  document: "文档",
  project: "项目",
};

function resultIcon(result: GlobalSearchResult) {
  if (result.type === "conversation") {
    return <ChatLines width={22} height={22} strokeWidth={1.8} />;
  }
  if (result.type === "project") {
    return <Folder width={22} height={22} strokeWidth={1.8} />;
  }
  if (result.type === "image") {
    return <MediaImage width={22} height={22} strokeWidth={1.8} />;
  }
  return (
    <FileKindIcon
      mimeType={result.mimeType || "application/octet-stream"}
      originalName={result.title}
      size={22}
    />
  );
}

function formatResultDate(value: string) {
  const date = new Date(value);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayDifference = Math.round(
    (startToday.getTime() - startDate.getTime()) / 86_400_000
  );
  if (dayDifference === 0) return "今天";
  if (dayDifference === 1) return "昨天";
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  }
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  const index = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if (index < 0) return text;
  return (
    <>
      {text.slice(0, index)}
      <mark className="bg-transparent font-semibold text-inherit">
        {text.slice(index, index + query.length)}
      </mark>
      {text.slice(index + query.length)}
    </>
  );
}

export function GlobalSearchDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [activeTab, setActiveTab] = useState<SearchTab>("all");
  const [activeIndex, setActiveIndex] = useState(0);
  const searchQuery = useGlobalSearch(debouncedQuery, open);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 180);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  const results = useMemo(() => {
    const all = searchQuery.data?.results || [];
    return activeTab === "all"
      ? all
          .slice()
          .sort(
            (left, right) =>
              new Date(right.updatedAt).getTime() -
              new Date(left.updatedAt).getTime()
          )
      : all.filter((result) => result.type === activeTab);
  }, [activeTab, searchQuery.data?.results]);

  function openResult(result: GlobalSearchResult) {
    onOpenChange(false);
    router.push(result.href);
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => Math.min(current + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter" && results[activeIndex]) {
      event.preventDefault();
      openResult(results[activeIndex]);
    }
  }

  const trimmedQuery = query.trim();
  const waitingForDebounce = trimmedQuery !== debouncedQuery.trim();
  const loading = waitingForDebounce || searchQuery.isFetching;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          "inset-x-0 bottom-0 top-auto max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-b-none rounded-t-[22px] border-x-0 border-b-0 bg-[var(--color-panel)] p-0 shadow-[var(--shadow-dialog)] md:left-1/2 md:w-[min(46rem,calc(100vw-2rem))] md:max-w-[46rem] md:-translate-x-1/2 md:translate-y-0 md:rounded-[22px] md:border",
          trimmedQuery
            ? "h-[min(82dvh,42rem)] md:top-[12vh] md:h-[min(72vh,42rem)]"
            : "h-auto md:bottom-auto md:top-[18vh]"
        )}
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <DialogTitle className="sr-only">全局搜索</DialogTitle>
        <DialogDescription className="sr-only">
          搜索你的对话、图片、文档和项目
        </DialogDescription>

        <div className="flex h-16 shrink-0 items-center gap-3 px-4 sm:px-6">
          <Search
            width={21}
            height={21}
            strokeWidth={1.8}
            className="shrink-0 text-[var(--color-text-tertiary)]"
          />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleInputKeyDown}
            placeholder="搜索对话、资料和项目"
            aria-label="全局搜索"
            aria-controls="global-search-results"
            aria-activedescendant={
              results[activeIndex]
                ? `global-search-result-${results[activeIndex].type}-${results[activeIndex].id}`
                : undefined
            }
            className="min-w-0 flex-1 bg-transparent text-base font-medium text-[var(--color-text-primary)] outline-none placeholder:font-normal placeholder:text-[var(--color-text-tertiary)]"
          />
          {trimmedQuery && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="h-9 shrink-0 rounded-[var(--radius-sm)] px-2.5 text-sm text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:bg-[var(--color-surface-hover)]"
            >
              清除
            </button>
          )}
          <span className="h-6 w-px bg-[var(--color-border-light)]" aria-hidden />
          <DialogClose asChild>
            <button
              type="button"
              className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:bg-[var(--color-surface-hover)]"
              aria-label="关闭全局搜索"
            >
              <Xmark width={20} height={20} strokeWidth={2} />
            </button>
          </DialogClose>
        </div>

        <div
          className="flex shrink-0 gap-1 overflow-x-auto px-4 pb-3 sm:px-6"
          role="tablist"
          aria-label="搜索类型"
        >
          {TABS.map((tab) => {
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => {
                  setActiveTab(tab.id);
                  setActiveIndex(0);
                }}
                className={cn(
                  "h-9 shrink-0 rounded-full px-4 text-sm transition-colors focus-visible:outline-none focus-visible:bg-[var(--color-surface-hover)]",
                  selected
                    ? "bg-[var(--color-interaction-active)] font-medium text-[var(--color-text-primary)]"
                    : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
                )}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div
          id="global-search-results"
          role="listbox"
          aria-label="搜索结果"
          className={cn(
            "min-h-0 overflow-y-auto px-3 pb-4 sm:px-5",
            trimmedQuery ? "flex-1" : "shrink-0"
          )}
        >
          {!trimmedQuery ? (
            <div className="flex h-full min-h-52 flex-col items-center justify-center px-6 text-center">
              <Search
                width={32}
                height={32}
                strokeWidth={1.5}
                className="mb-4 text-[var(--color-text-tertiary)]"
              />
              <p className="text-sm font-medium text-[var(--color-text-primary)]">
                搜索你的 LumenLab
              </p>
              <p className="mt-1.5 max-w-sm text-xs leading-5 text-[var(--color-text-tertiary)]">
                可检索对话内容、项目名称，以及资料文件名与已解析正文
              </p>
            </div>
          ) : loading && results.length === 0 ? (
            <div className="flex h-40 items-center justify-center" role="status">
              <Spinner className="text-[var(--color-text-tertiary)]" />
              <span className="sr-only">正在搜索</span>
            </div>
          ) : searchQuery.isError ? (
            <div className="flex h-40 flex-col items-center justify-center text-center">
              <p className="text-sm text-[var(--color-text-primary)]">搜索暂时不可用</p>
              <button
                type="button"
                onClick={() => void searchQuery.refetch()}
                className="mt-2 rounded-[var(--radius-sm)] px-3 py-2 text-xs font-medium text-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] focus-visible:outline-none focus-visible:bg-[var(--color-accent-soft)]"
              >
                重试
              </button>
            </div>
          ) : results.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center px-5 text-center">
              <p className="text-sm text-[var(--color-text-primary)]">
                没有找到“{trimmedQuery}”
              </p>
              <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">
                试试更短的关键词或切换到“全部”
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {results.map((result, index) => (
                <button
                  key={`${result.type}-${result.id}`}
                  id={`global-search-result-${result.type}-${result.id}`}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  onPointerMove={() => setActiveIndex(index)}
                  onClick={() => openResult(result)}
                  className={cn(
                    "group flex w-full items-center gap-3 rounded-[var(--radius-lg)] px-3 py-3 text-left transition-colors focus-visible:outline-none",
                    index === activeIndex
                      ? "bg-[var(--color-interaction-active)]"
                      : "hover:bg-[var(--color-surface-hover)] focus-visible:bg-[var(--color-surface-hover)]"
                  )}
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-project-control)] text-[var(--color-text-secondary)]">
                    {resultIcon(result)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-[var(--color-text-primary)]">
                      <HighlightedText text={result.title} query={trimmedQuery} />
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-[var(--color-text-tertiary)]">
                      {result.snippet ? (
                        <HighlightedText text={result.snippet} query={trimmedQuery} />
                      ) : (
                        result.subtitle || TYPE_LABEL[result.type]
                      )}
                    </span>
                  </span>
                  <span className="shrink-0 pl-2 text-xs text-[var(--color-text-tertiary)]">
                    {formatResultDate(result.updatedAt)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="hidden h-9 shrink-0 items-center justify-between border-t border-[var(--color-border-light)] px-6 text-[11px] text-[var(--color-text-tertiary)] sm:flex">
          <span>↑↓ 选择 · Enter 打开</span>
          <span>Esc 关闭</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
