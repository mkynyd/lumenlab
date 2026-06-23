"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, FileText, Globe, Paperclip, Send, Sparkles, User, X } from "lucide-react";
import { MarkdownContent } from "@/components/markdown/markdown-content";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { MOCK_CHAT_MESSAGES, type MockChatMessage } from "@/lib/mock/landing-fixtures";

/**
 * 缩放版聊天演示。纯 mock 数据驱动，不接 API / SSE。
 * 视觉上贴近 /chat 工作台：
 *  - 顶部一条 fake 标题栏（与 hero 区分，不显示 nav）
 *  - 消息列表：4 条 mock，user 右气泡、assistant 走 MarkdownContent
 *  - 底部：禁用输入 + 模型徽章
 */
export function ChatDemo({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-[var(--radius-xl)] bg-[var(--color-surface)]",
        "shadow-[var(--shadow-panel)]",
        className
      )}
    >
      <div className="flex items-center justify-between border-b border-[var(--color-border-light)] bg-[var(--color-panel)] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-[var(--color-success)]" aria-hidden />
          <span className="text-xs font-medium text-[var(--color-text-secondary)]">光电效应实验复盘</span>
        </div>
        <span className="text-[11px] text-[var(--color-text-tertiary)]">在线 · 深度推理</span>
      </div>

      <div className="flex-1 space-y-3 overflow-hidden bg-[var(--color-bg)] px-3 py-4 sm:px-4">
        {MOCK_CHAT_MESSAGES.map((message) => (
          <MockBubble key={message.id} message={message} />
        ))}
      </div>

      <ChatDemoInputDock />
    </div>
  );
}

function MockBubble({ message }: { message: MockChatMessage }) {
  const isUser = message.role === "user";
  const [reasoningOpen, setReasoningOpen] = useState(false);

  return (
    <div className={cn("flex gap-2.5", isUser && "flex-row-reverse")}>
      <div
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-md)]",
          isUser
            ? "bg-[var(--color-accent)] text-[var(--color-accent-contrast)]"
            : "bg-[var(--color-panel-muted)] text-[var(--color-text-secondary)]"
        )}
      >
        {isUser ? <User size={12} /> : <Sparkles size={12} />}
      </div>

      <div className={cn("min-w-0 flex-1", isUser && "flex flex-col items-end")}>
        {message.reasoningContent && (
          <Collapsible
            open={reasoningOpen}
            onOpenChange={setReasoningOpen}
            className="mb-1.5 w-full max-w-[74ch]"
          >
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1.5 rounded-[var(--radius-md)] px-1.5 py-1 text-[11px] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-secondary)]"
                aria-expanded={reasoningOpen}
              >
                {reasoningOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                思考过程
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <p className="mt-1 max-w-[74ch] rounded-[var(--radius-md)] bg-[var(--color-panel-muted)] px-3 py-2 text-[12px] leading-relaxed text-[var(--color-text-secondary)]">
                {message.reasoningContent}
              </p>
            </CollapsibleContent>
          </Collapsible>
        )}

        <div
          className={cn(
            "max-w-[85%] rounded-[var(--radius-lg)] px-3 py-2 text-[13px] leading-relaxed",
            isUser
              ? "bg-[var(--color-accent-soft)] text-[var(--color-text-primary)]"
              : "bg-transparent pl-0"
          )}
        >
          {isUser ? (
            message.content
          ) : (
            <div className="text-[var(--color-text-primary)]">
              <MarkdownContent content={message.content} imageLoading="lazy" />
            </div>
          )}
        </div>

        <div className="mt-1 px-1 text-[10px] tabular-nums text-[var(--color-text-tertiary)]">
          {message.tokenCount} tokens
        </div>
      </div>
    </div>
  );
}

function ChatDemoInputDock() {
  return (
    <div className="border-t border-[var(--color-border-light)] bg-[var(--color-surface)] px-3 py-3">
      <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-lg)] bg-[var(--color-panel-muted)] px-2.5 py-2">
        <button
          type="button"
          disabled
          className="flex size-6 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-tertiary)]"
          aria-label="附件"
        >
          <Paperclip size={13} />
        </button>
        <span className="hidden h-3 w-px bg-[var(--color-border-light)] sm:inline-block" />
        <span className="flex-1 truncate text-[12px] text-[var(--color-text-tertiary)]">
          向 LumenLab 提问，支持附件、引用资料…
        </span>
        <span className="inline-flex items-center gap-1 rounded-[var(--radius-md)] bg-[var(--color-surface)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--color-text-secondary)]">
          深度推理 · DeepSeek
          <ChevronDown size={10} />
        </span>
        <span className="hidden text-[var(--color-text-tertiary)] sm:inline-flex">
          <Globe size={12} />
        </span>
        <button
          type="button"
          disabled
          className="flex size-6 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-accent)] text-[var(--color-accent-contrast)] disabled:opacity-60"
          aria-label="发送"
        >
          <Send size={12} />
        </button>
      </div>
      <div className="mt-1.5 flex items-center gap-3 text-[10px] text-[var(--color-text-tertiary)]">
        <span className="inline-flex items-center gap-1">
          <FileText size={10} />
          1 资料已挂载
        </span>
        <span className="inline-flex items-center gap-1">
          <X size={10} />
          可在 /chat 关闭
        </span>
      </div>
    </div>
  );
}
