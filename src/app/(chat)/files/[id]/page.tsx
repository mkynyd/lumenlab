"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Send, Sparks } from "iconoir-react";
import { Button } from "@/components/ui/button";
import { FileDetailDialog } from "@/components/files/file-detail-dialog";
import { fetchJson } from "@/lib/api/client";
import { queryKeys } from "@/lib/query-keys";

interface PageFileDetail {
  id: string;
  originalName: string;
  projectId: string | null;
}

/**
 * 文件详情的全屏页。
 *
 * 与弹窗打开的是同一个 `FileDetailDialog`（`shell="embedded"`），差别只在
 * 外面这层：面包屑导航，以及底部常驻的「询问关于此文件的问题」——把问题带到
 * 文件所属项目的对话里，并在那边预选好这份文件。
 */
export default function FileDetailPage() {
  const params = useParams();
  const router = useRouter();
  const fileId = params.id as string;
  const [question, setQuestion] = useState("");

  // 与详情组件共用同一个 queryKey，命中缓存不会重复请求。
  const detailQuery = useQuery({
    queryKey: queryKeys.files.detail(fileId),
    queryFn: () => fetchJson<{ file: PageFileDetail }>(`/api/files/${fileId}`),
  });
  const file = detailQuery.data?.file;

  function ask() {
    const trimmed = question.trim();
    if (!trimmed) return;
    const target = file?.projectId
      ? `/projects/${file.projectId}?file=${fileId}&q=${encodeURIComponent(trimmed)}`
      : `/chat?q=${encodeURIComponent(trimmed)}`;
    router.push(target);
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--color-bg)]">
      <header className="flex shrink-0 items-center gap-2 px-3 py-2 sm:px-4">
        <button
          type="button"
          onClick={() => router.push("/files")}
          aria-label="返回资料库"
          className="flex size-9 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-project-surface-hover)] hover:text-[var(--color-text-primary)]"
        >
          <ArrowLeft width={16} height={16} strokeWidth={1.8} />
        </button>
        <nav
          aria-label="面包屑"
          className="flex min-w-0 items-center gap-1.5 text-sm"
        >
          <button
            type="button"
            onClick={() => router.push("/files")}
            className="shrink-0 text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-secondary)]"
          >
            资料库
          </button>
          <span aria-hidden className="shrink-0 text-[var(--color-text-tertiary)]">
            /
          </span>
          <span className="truncate font-medium text-[var(--color-text-primary)]">
            {file?.originalName ?? "加载中…"}
          </span>
        </nav>
      </header>

      <FileDetailDialog
        file={{ id: fileId }}
        shell="embedded"
        onClose={() => router.push("/files")}
        onChanged={() => void detailQuery.refetch()}
      />

      <footer className="shrink-0 border-t border-[var(--color-border-light)] px-3 py-3 sm:px-4">
        <div className="mx-auto flex max-w-3xl items-center gap-2 rounded-full bg-[var(--color-project-control)] px-3 py-1.5">
          <Sparks
            width={16}
            height={16}
            strokeWidth={1.7}
            className="shrink-0 text-[var(--color-text-tertiary)]"
          />
          <input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                ask();
              }
            }}
            placeholder="询问关于此文件的问题"
            aria-label="询问关于此文件的问题"
            className="min-w-0 flex-1 bg-transparent text-sm text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)]"
          />
          <Button
            size="icon"
            variant="ghost"
            aria-label="发送"
            disabled={!question.trim()}
            onClick={ask}
            className="size-7 shrink-0 rounded-full text-[var(--color-text-tertiary)]"
          >
            <Send width={15} height={15} strokeWidth={1.8} />
          </Button>
        </div>
        <p className="mt-1.5 text-center text-[11px] text-[var(--color-text-tertiary)]">
          问题会带到该文件所属项目的对话里继续
        </p>
      </footer>
    </div>
  );
}
