"use client";

import { FileText, Folder, Search, Settings, Trash } from "lucide-react";
import { ChatLines } from "iconoir-react";
import { SpotlightCard } from "@/components/workbench/spotlight-card";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { FILE_CATEGORIES, type FileCategory } from "@/lib/file-categories";
import { MOCK_PROJECT, type MockProjectFile } from "@/lib/mock/landing-fixtures";

/**
 * 缩放版项目演示。纯 mock 数据驱动。
 * 视觉贴近 /projects 列表 + /projects/[id] 侧栏：
 *  - 顶部 SpotlightCard：项目名 / 类型 / 描述 / 计数
 *  - 资料分类列表，按 FILE_CATEGORIES 顺序分组
 */
export function ProjectDemo({ className }: { className?: string }) {
  const grouped = groupFilesByCategory(MOCK_PROJECT.files);

  return (
    <div
      className={cn(
        "flex flex-col gap-3 overflow-hidden rounded-[var(--radius-xl)] bg-[var(--color-panel)] p-4",
        "shadow-[var(--shadow-panel)]",
        className
      )}
    >
      <SpotlightCard className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
                <Folder size={14} />
              </span>
              <h3 className="truncate text-[14px] font-semibold text-[var(--color-text-primary)]">
                {MOCK_PROJECT.name}
              </h3>
              <span className="inline-flex h-5 items-center rounded-4xl bg-[var(--color-surface-active)] px-2 text-[10.5px] font-medium text-[var(--color-text-secondary)]">
                {MOCK_PROJECT.type}
              </span>
            </div>
            <p className="mt-1.5 line-clamp-2 text-[12px] text-[var(--color-text-tertiary)]">
              {MOCK_PROJECT.description}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <span className="flex size-6 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-tertiary)]">
              <Settings size={12} />
            </span>
            <span className="flex size-6 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-tertiary)]">
              <Trash size={12} />
            </span>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-3 text-[11px] text-[var(--color-text-tertiary)]">
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
      </SpotlightCard>

      <div className="flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-surface)] px-2.5 py-1.5">
        <Search size={12} className="text-[var(--color-text-tertiary)]" />
        <span className="flex-1 text-[12px] text-[var(--color-text-tertiary)]">搜索资料、对话…</span>
        <span className="rounded-[var(--radius-xs)] bg-[var(--color-panel-muted)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-tertiary)]">
          {MOCK_PROJECT.files.length}
        </span>
      </div>

      <ul className="flex flex-col gap-2.5">
        {FILE_CATEGORIES.map((category) => {
          const items = grouped.get(category) ?? [];
          if (items.length === 0) return null;
          return (
            <li key={category} className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5 px-1 text-[10.5px] font-medium uppercase tracking-wider text-[var(--color-text-tertiary)]">
                {category}
                <span className="rounded-[var(--radius-xs)] bg-[var(--color-surface-active)] px-1 text-[10px] tabular-nums text-[var(--color-text-secondary)]">
                  {items.length}
                </span>
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
    <li className="flex items-center gap-2 rounded-[var(--radius-md)] px-2 py-1.5 text-[12px] hover:bg-[var(--color-surface-hover)]">
      <FileText size={12} className="shrink-0 text-[var(--color-text-tertiary)]" />
      <span className="flex-1 truncate text-[var(--color-text-primary)]">{file.name}</span>
      <span className="shrink-0 text-[10.5px] tabular-nums text-[var(--color-text-tertiary)]">{file.size}</span>
      {file.status === "parsing" && (
        <span className="inline-flex items-center gap-1 rounded-4xl bg-[var(--color-info-muted)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-info)]">
          <Spinner className="size-2.5" />
          解析中
        </span>
      )}
      {file.status === "ready" && file.pageCount && (
        <span className="shrink-0 text-[10.5px] tabular-nums text-[var(--color-text-tertiary)]">
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
