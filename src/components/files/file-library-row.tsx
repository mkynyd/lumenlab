"use client";

import Link from "next/link";
import {
  Download,
  Eye,
  Folder,
  MoreHoriz,
  Refresh,
  Trash,
} from "iconoir-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { FileLibraryItem } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/**
 * 状态用扁平低饱和色块 + 文字表达：颜色只是辅助，文字本身说明状态，
 * 因此不依赖颜色也能读懂。「索引不完整」与「解析失败」是两回事，
 * 不合并成一个状态。
 */
type StatusTone = "neutral" | "progress" | "warning" | "error";

interface StatusView {
  label: string;
  tone: StatusTone;
  hint?: string;
}

const STATUS_TONE_CLASS: Record<StatusTone, string> = {
  neutral:
    "bg-[var(--color-project-control)] text-[var(--color-text-secondary)]",
  progress: "bg-[var(--color-accent-soft)] text-[var(--color-accent)]",
  warning:
    "bg-[var(--color-warning-muted)] text-[var(--color-warning)]",
  error: "bg-[var(--color-error-muted)] text-[var(--color-error)]",
};

function statusView(file: FileLibraryItem): StatusView {
  if (file.status === "failed") {
    return { label: "解析失败", tone: "error" };
  }
  if (file.status === "parsing" || file.status === "uploaded") {
    return { label: "解析中", tone: "progress" };
  }
  if (file.warningCount > 0) {
    return {
      label: "有警告",
      tone: "warning",
      hint: `解析过程有 ${file.warningCount} 条提醒，展开详情可核对`,
    };
  }
  if (
    file.embeddingStatus === "missing" ||
    file.embeddingStatus === "partial"
  ) {
    return {
      label: "索引不完整",
      tone: "warning",
      hint: "向量索引不完整，检索精度可能受影响",
    };
  }
  return { label: "已解析", tone: "neutral" };
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatUpdated(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const diffMs = Date.now() - date.getTime();
  const day = 24 * 60 * 60 * 1000;
  if (diffMs < day) return "今天";
  if (diffMs < 2 * day) return "昨天";
  if (diffMs < 7 * day) return `${Math.floor(diffMs / day)} 天前`;
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

/** 命中词高亮：用低饱和色块而不是浏览器默认的黄底。 */
function Highlight({ text, query }: { text: string; query?: string }) {
  const needle = query?.trim();
  if (!needle) return <>{text}</>;
  const index = text.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <mark className="rounded-[3px] bg-[var(--color-accent-soft)] px-0.5 text-[var(--color-text-primary)]">
        {text.slice(index, index + needle.length)}
      </mark>
      {text.slice(index + needle.length)}
    </>
  );
}

export interface FileLibraryRowProps {
  file: FileLibraryItem;
  query?: string;
  onPreview: (file: FileLibraryItem) => void;
  onReparse: (file: FileLibraryItem) => void;
  onDelete: (file: FileLibraryItem) => void;
  /** 批量选择状态：复选框在桌面端常驻可聚焦，移动端收进行尾菜单。 */
  selected?: boolean;
  onSelectedChange?: (file: FileLibraryItem, selected: boolean) => void;
}

export function FileLibraryRow({
  file,
  query,
  onPreview,
  onReparse,
  onDelete,
  selected = false,
  onSelectedChange,
}: FileLibraryRowProps) {
  const status = statusView(file);
  const snippet = file.matchKind === "content" ? file.snippet : null;

  return (
    <div
      role="listitem"
      className={cn(
        "group relative flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-2.5",
        "transition-colors duration-150 hover:bg-[var(--color-project-surface-hover)] focus-within:bg-[var(--color-project-surface-hover)]",
        selected && "bg-[var(--color-accent-soft)]"
      )}
    >
      {onSelectedChange && (
        <input
          type="checkbox"
          checked={selected}
          onChange={(event) => onSelectedChange(file, event.target.checked)}
          aria-label={`选择 ${file.originalName}`}
          className={cn(
            "hidden size-4 shrink-0 accent-[var(--color-accent)] sm:block",
            // 未选中时保持低调，但键盘聚焦与 hover 都能唤出，不依赖鼠标。
            !selected &&
              "opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
          )}
        />
      )}

      {/* 整行点击打开详情；内容区是按钮而不是链接，避免嵌套交互元素 */}
      <button
        type="button"
        onClick={() => onPreview(file)}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-[var(--radius-md)] text-left focus-visible:outline-none"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-[var(--color-text-primary)]">
            <Highlight text={file.originalName} query={query} />
          </p>
          <p className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-[var(--color-text-tertiary)]">
            {file.projectName ? (
              <span className="truncate">
                <Highlight text={file.projectName} query={file.matchKind === "project" ? query : undefined} />
              </span>
            ) : (
              <span className="truncate">未归属项目</span>
            )}
            {/* 移动端只保留文件名、项目与状态，分类和大小在更宽的屏幕上出现 */}
            {file.category && (
              <>
                <span aria-hidden className="hidden sm:inline">
                  ·
                </span>
                <span className="hidden truncate sm:inline">{file.category}</span>
              </>
            )}
            <span aria-hidden className="hidden sm:inline">
              ·
            </span>
            <span className="hidden shrink-0 tabular-nums sm:inline">
              {formatSize(file.size)}
            </span>
          </p>
          {snippet && (
            <p className="mt-0.5 line-clamp-1 text-xs text-[var(--color-text-tertiary)]">
              {snippet}
            </p>
          )}
        </div>

        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[11px] leading-5",
            STATUS_TONE_CLASS[status.tone]
          )}
          title={status.hint}
        >
          {status.label}
        </span>

        <span className="hidden w-16 shrink-0 text-right text-xs tabular-nums text-[var(--color-text-tertiary)] sm:block">
          {formatUpdated(file.updatedAt)}
        </span>
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`${file.originalName} 的更多操作`}
            className="size-8 shrink-0 text-[var(--color-text-tertiary)] opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100 max-sm:opacity-100"
          >
            <MoreHoriz width={16} height={16} strokeWidth={1.8} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onSelect={() => onPreview(file)}>
            <Eye width={15} height={15} strokeWidth={1.8} />
            查看
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href={`/api/files/${file.id}/content?download=1`} download>
              <Download width={15} height={15} strokeWidth={1.8} />
              下载原件
            </a>
          </DropdownMenuItem>
          {file.projectId && (
            <DropdownMenuItem asChild>
              <Link href={`/projects/${file.projectId}`}>
                <Folder width={15} height={15} strokeWidth={1.8} />
                进入所属项目
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => onReparse(file)}>
            <Refresh width={15} height={15} strokeWidth={1.8} />
            重新解析
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => onDelete(file)}
            className="text-[var(--color-error)] focus:text-[var(--color-error)]"
          >
            <Trash width={15} height={15} strokeWidth={1.8} />
            删除
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
