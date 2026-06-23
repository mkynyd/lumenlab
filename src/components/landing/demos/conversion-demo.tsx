"use client";

import { ArrowDownToLine, Check, Download, Folder, Save } from "lucide-react";
import { MarkdownContent } from "@/components/markdown/markdown-content";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MOCK_CONVERSION } from "@/lib/mock/landing-fixtures";

/**
 * 缩放版文档转换演示。纯 mock 数据驱动。
 * 视觉贴近 /tools 列表 + 转换详情：
 *  - 顶部：标题 + 元信息 + 3 个动作按钮
 *  - 中部：4 段进度（上传/排队/解析/完成），全部 done
 *  - 底部：MarkdownContent 预览面板
 */
export function ConversionDemo({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-[var(--radius-xl)] bg-[var(--color-surface)]",
        "shadow-[var(--shadow-panel)]",
        className
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-border-light)] bg-[var(--color-panel)] px-4 py-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10.5px] font-medium uppercase tracking-wider text-[var(--color-text-tertiary)]">
            文档工具
          </div>
          <h3 className="mt-0.5 truncate text-[14px] font-semibold text-[var(--color-text-primary)]">
            {MOCK_CONVERSION.title}
          </h3>
          <p className="mt-0.5 truncate text-[12px] text-[var(--color-text-tertiary)]">
            {MOCK_CONVERSION.originalName} · {MOCK_CONVERSION.pageCount} 页 · {MOCK_CONVERSION.fileSize} · {MOCK_CONVERSION.createdAt}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button variant="ghost" size="sm" disabled className="h-7 gap-1 rounded-[var(--radius-md)] px-2 text-[12px]">
            <Download size={12} />
            下载 .md
          </Button>
          <Button variant="outline" size="sm" disabled className="h-7 gap-1 rounded-[var(--radius-md)] px-2 text-[12px]">
            <Save size={12} />
            保存到项目
          </Button>
          <Button variant="default" size="sm" disabled className="h-7 gap-1 rounded-[var(--radius-md)] px-2 text-[12px]">
            <ArrowDownToLine size={12} />
            完整包
          </Button>
        </div>
      </div>

      <div className="border-b border-[var(--color-border-light)] bg-[var(--color-bg)] px-4 py-3">
        <ol className="flex items-center gap-1.5 text-[11px]">
          {MOCK_CONVERSION.stages.map((stage, index) => (
            <li key={stage.key} className="flex flex-1 items-center gap-1.5">
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium",
                  stage.done
                    ? "bg-[var(--color-accent)] text-[var(--color-accent-contrast)]"
                    : "bg-[var(--color-surface-active)] text-[var(--color-text-tertiary)]"
                )}
                aria-hidden
              >
                {stage.done ? <Check size={11} /> : index + 1}
              </span>
              <span
                className={cn(
                  "truncate font-medium",
                  stage.done ? "text-[var(--color-text-secondary)]" : "text-[var(--color-text-tertiary)]"
                )}
              >
                {stage.label}
              </span>
              {index < MOCK_CONVERSION.stages.length - 1 && (
                <span
                  className={cn(
                    "h-px flex-1",
                    stage.done ? "bg-[var(--color-accent)]" : "bg-[var(--color-border-light)]"
                  )}
                />
              )}
            </li>
          ))}
        </ol>
      </div>

      <div className="max-h-[420px] overflow-auto bg-[var(--color-panel-muted)] px-5 py-4">
        <article className="markdown-body mx-auto max-w-3xl">
          <MarkdownContent content={MOCK_CONVERSION.markdownSample} imageLoading="lazy" />
        </article>
      </div>

      <div className="flex items-center gap-2 border-t border-[var(--color-border-light)] bg-[var(--color-panel)] px-4 py-2 text-[11px] text-[var(--color-text-tertiary)]">
        <Folder size={11} />
        <span>导出包含 Markdown · pics/ · 打印版 PDF · DOCX</span>
      </div>
    </div>
  );
}
