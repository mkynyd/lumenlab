"use client";

import { FileText, Folder, Search, Settings, Trash } from "lucide-react";
import { ChatLines } from "iconoir-react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { FILE_CATEGORIES, type FileCategory } from "@/lib/file-categories";
import { MOCK_PROJECT, type MockProjectFile } from "@/lib/mock/landing-fixtures";

/**
 * 缩放版项目演示。纯 mock 数据驱动。
 * 视觉贴近 /projects 列表 + /projects/[id] 侧栏：
 *  - 顶部项目信息：项目名 / 类型 / 描述 / 计数
 *  - 资料分类列表，按 FILE_CATEGORIES 顺序分组
 */
export function ProjectDemo({ className }: { className?: string }) {
  const grouped = groupFilesByCategory(MOCK_PROJECT.files);

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden rounded-[inherit] bg-[var(--color-panel)]",
        className
      )}
    >
      <div className="shrink-0 border-b border-[var(--color-border-light)] px-4 py-4 sm:px-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Folder size={14} className="shrink-0 text-[var(--color-accent)]" />
              <h3 className="truncate text-[14px] font-semibold text-[var(--color-text-primary)]">
                {MOCK_PROJECT.name}
              </h3>
              <span className="inline-flex h-5 items-center rounded-full bg-[var(--color-surface-active)] px-2 text-[10px] font-medium text-[var(--color-text-secondary)]">
                {MOCK_PROJECT.type}
              </span>
            </div>
            <p className="mt-1.5 line-clamp-2 text-[12px] text-[var(--color-text-tertiary)]">
              {MOCK_PROJECT.description}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <span className="flex size-7 items-center justify-center rounded-lg text-[var(--color-text-tertiary)]">
              <Settings size={12} />
            </span>
            <span className="flex size-7 items-center justify-center rounded-lg text-[var(--color-text-tertiary)]">
              <Trash size={12} />
            </span>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-3 text-xs text-[var(--color-text-tertiary)]">
          <span className="inline-flex items-center gap-1">
            <ChatLines width={11} height={11} strokeWidth={2} />
            {MOCK_PROJECT.conversationCount} 对话
          </span>
          <span className="inline-flex items-center gap-1">
            <FileText size={11} />
            {MOCK_PROJECT.artifactCount} 成果
          </span>
          <span className="ml-auto text-[var(--color-text-tertiary)]">2 小时前</span>
        </div>
      </div>

      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-[var(--color-border-light)] px-3 text-[12px] sm:px-4">
        <span className="rounded-lg bg-[var(--color-surface-active)] px-2.5 py-1 font-medium text-[var(--color-text-primary)]">
          资料
        </span>
        <span className="rounded-lg px-2.5 py-1 text-[var(--color-text-secondary)]">
          对话
        </span>
        <span className="rounded-lg px-2.5 py-1 text-[var(--color-text-secondary)]">
          成果
        </span>
      </div>

      <div className="mx-3 mt-3 flex shrink-0 items-center gap-2 rounded-xl bg-[var(--color-surface)] px-3 py-2 sm:mx-4">
        <Search size={12} className="text-[var(--color-text-tertiary)]" />
        <span className="flex-1 text-[12px] text-[var(--color-text-tertiary)]">搜索项目资料</span>
        <span className="text-[10px] tabular-nums text-[var(--color-text-tertiary)]">
          {MOCK_PROJECT.files.length}
        </span>
      </div>

      <ul className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-3 py-3 sm:px-4">
        {FILE_CATEGORIES.map((category) => {
          const items = grouped.get(category) ?? [];
          if (items.length === 0) return null;
          return (
            <li key={category} className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5 px-1 text-[11px] font-medium text-[var(--color-text-tertiary)]">
                {category}
                <span className="tabular-nums">{items.length}</span>
              </div>
              <ul className="flex flex-col gap-0.5">
                {items.map((file) => (
                  <FileRow key={file.id} file={file} />
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function FileRow({ file }: { file: MockProjectFile }) {
  return (
    <li className="flex min-h-9 items-center gap-2 rounded-lg px-2 text-[12px] hover:bg-[var(--color-surface-hover)]">
      <FileText size={12} className="shrink-0 text-[var(--color-text-tertiary)]" />
      <span className="flex-1 truncate text-[var(--color-text-primary)]">{file.name}</span>
      <span className="shrink-0 text-xs tabular-nums text-[var(--color-text-tertiary)]">{file.size}</span>
      {file.status === "parsing" && (
        <span className="inline-flex items-center gap-1 rounded-4xl bg-[var(--color-info-muted)] px-1.5 py-0.5 text-xs font-medium text-[var(--color-info)]">
          <Spinner className="size-2.5" />
          解析中
        </span>
      )}
      {file.status === "ready" && file.pageCount && (
        <span className="shrink-0 text-xs tabular-nums text-[var(--color-text-tertiary)]">
          {file.pageCount} 页
        </span>
      )}
    </li>
  );
}

function groupFilesByCategory(files: MockProjectFile[]): Map<FileCategory, MockProjectFile[]> {
  const map = new Map<FileCategory, MockProjectFile[]>();
  for (const category of FILE_CATEGORIES) map.set(category, []);
  for (const file of files) {
    const list = map.get(file.category);
    if (list) list.push(file);
  }
  return map;
}
