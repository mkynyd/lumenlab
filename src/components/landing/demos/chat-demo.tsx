"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, FileText, Globe, Paperclip, Send } from "lucide-react";
import { MarkdownContent } from "@/components/markdown/markdown-content";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ModelSelector } from "@/components/chat/model-selector";
import { cn } from "@/lib/utils";
import { MOCK_CHAT_MESSAGES, type MockChatMessage } from "@/lib/mock/landing-fixtures";

/**
 * 缩放版聊天演示。纯 mock 数据驱动，不接 API / SSE。
 * 输入框结构与 /chat 工作台真实 ChatInput 保持一致：textarea + 工具行；
 * ModelSelector 直接复用真实组件，确保下拉菜单视觉与 /chat 一致。
 */
export function ChatDemo({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden rounded-[inherit] bg-[var(--color-surface)]",
        className
      )}
    >
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--color-border-light)] bg-[var(--color-panel)] px-4">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-[var(--color-text-primary)]">光电效应实验复盘</span>
        </div>
        <span className="rounded-full bg-[var(--color-surface-active)] px-2 py-1 text-[11px] text-[var(--color-text-secondary)]">
          DeepSeek · 深度
        </span>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-hidden bg-[var(--color-bg)] px-4 py-5 sm:px-7 sm:py-7">
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
    <div className={cn("flex", isUser && "justify-end")}>
      <div className={cn("min-w-0", isUser ? "flex max-w-[72%] flex-col items-end" : "w-full")}>
        {message.reasoningContent && (
          <Collapsible
            open={reasoningOpen}
            onOpenChange={setReasoningOpen}
            className="mb-2 w-full max-w-[74ch]"
          >
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1.5 rounded-lg px-1 py-1 text-[11px] text-[var(--color-text-tertiary)] transition-colors duration-200 hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-secondary)]"
                aria-expanded={reasoningOpen}
              >
                {reasoningOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                思考过程
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <p className="mt-1 max-w-[74ch] border-l border-[var(--color-border-light)] pl-3 text-[12px] leading-relaxed text-[var(--color-text-secondary)]">
                {message.reasoningContent}
              </p>
            </CollapsibleContent>
          </Collapsible>
        )}

        <div
          className={cn(
            "text-[13px] leading-relaxed",
            isUser
              ? "rounded-[18px] bg-[var(--color-surface-active)] px-3.5 py-2.5 text-[var(--color-text-primary)]"
              : "max-w-[74ch] text-[var(--color-text-primary)]"
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
      </div>
    </div>
  );
}

/**
 * 视觉上与 /chat 工作台的 ChatInput 保持一致：
 *  - 外层圆角面板
 *  - 顶部 textarea（单行 min-h-9）
 *  - 底部工具行：[Paperclip] [ModelSelector（真实组件）] [Globe] [Send]
 *  - 底栏挂载/关闭提示
 * 输入框与按钮全部 disabled，纯展示。
 */
function ChatDemoInputDock() {
  return (
    <div className="shrink-0 bg-[var(--color-bg)] px-3 pb-3 sm:px-5 sm:pb-5">
      <div className="rounded-[24px] bg-[var(--color-surface)] p-2 ring-1 ring-[var(--color-border-light)] shadow-[0_1px_2px_rgb(0_0_0/0.04),0_8px_24px_rgb(0_0_0/0.035)]">
        <div className="min-h-9 px-2 py-2 text-[13px] leading-snug text-[var(--color-text-tertiary)]">
          向 LumenLab 提问，支持附件、引用资料…
        </div>
        <div className="mt-1 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <button
              type="button"
              disabled
              className="flex size-8 shrink-0 items-center justify-center rounded-full text-[var(--color-text-tertiary)] disabled:opacity-60"
              aria-label="添加附件"
            >
              <Paperclip size={17} strokeWidth={2} />
            </button>
            <ModelSelector
              model="deepseek-v4-pro"
              onChange={() => {}}
              reasoningEffort="max"
              onReasoningEffortChange={() => {}}
              compact
            />
            <button
              type="button"
              disabled
              className="flex size-8 shrink-0 items-center justify-center rounded-full text-[var(--color-text-tertiary)] disabled:opacity-60"
              aria-label="联网搜索"
            >
              <Globe size={17} strokeWidth={2} />
            </button>
          </div>
          <button
            type="button"
            disabled
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)] text-[var(--color-accent-contrast)] disabled:opacity-60"
            aria-label="发送消息"
          >
            <Send size={17} strokeWidth={2} />
          </button>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-center gap-1.5 text-[10px] text-[var(--color-text-tertiary)]">
        <span className="inline-flex items-center gap-1">
          <FileText size={10} />
          已挂载 1 份项目资料
        </span>
      </div>
    </div>
  );
}
