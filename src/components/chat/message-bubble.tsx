"use client";

import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight, User, Bot } from "lucide-react";

interface MessageBubbleProps {
  role: "user" | "assistant" | "system";
  content: string;
  reasoningContent?: string | null;
  tokenCount?: number | null;
  isStreaming?: boolean;
}

function renderMarkdown(text: string): string {
  // 简易 Markdown → HTML（代码块、粗体、斜体、行内代码）
  let html = text
    // 代码块 ```
    .replace(
      /```(\w*)\n([\s\S]*?)```/g,
      (_: string, lang: string, code: string) => {
        const escaped = code
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
        return `<pre class="bg-[var(--color-surface-hover)] border border-[var(--color-border)] rounded-[var(--radius-md)] p-3 my-2 overflow-x-auto"><code class="text-xs font-mono">${escaped}</code></pre>`;
      }
    )
    // 行内代码 `...`
    .replace(
      /`([^`]+)`/g,
      '<code class="px-1 py-0.5 text-xs font-mono bg-[var(--color-surface-hover)] rounded-[2px]">$1</code>'
    )
    // 粗体 **...**
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    // 斜体 *...*
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    // 换行
    .replace(/\n\n/g, "</p><p class='mt-2'>")
    .replace(/\n/g, "<br/>");

  return `<p>${html}</p>`;
}

export function MessageBubble({
  role,
  content,
  reasoningContent,
  tokenCount,
  isStreaming = false,
}: MessageBubbleProps) {
  const [showReasoning, setShowReasoning] = useState(false);

  const isUser = role === "user";
  const isAssistant = role === "assistant";

  if (!isUser && !isAssistant) return null;

  const toggleReasoning = useCallback(() => {
    setShowReasoning((prev) => !prev);
  }, []);

  return (
    <div
      className={cn(
        "flex gap-3 px-4 py-3",
        isUser && "flex-row-reverse"
      )}
    >
      {/* 头像 */}
      <div
        className={cn(
          "flex items-center justify-center w-7 h-7 rounded-[var(--radius-sm)] shrink-0 mt-0.5",
          isUser
            ? "bg-[var(--color-accent)] text-white"
            : "bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]"
        )}
      >
        {isUser ? (
          <User size={14} strokeWidth={2} />
        ) : (
          <Bot size={14} strokeWidth={2} />
        )}
      </div>

      {/* 内容 */}
      <div className={cn("flex-1 min-w-0", isUser && "flex flex-col items-end")}>
        {/* 思维链（可折叠） */}
        {reasoningContent && (
          <div className="mb-2">
            <button
              onClick={toggleReasoning}
              className={cn(
                "flex items-center gap-1 text-xs text-[var(--color-text-tertiary)]",
                "hover:text-[var(--color-text-secondary)] transition-colors"
              )}
            >
              {showReasoning ? (
                <ChevronDown size={12} strokeWidth={2} />
              ) : (
                <ChevronRight size={12} strokeWidth={2} />
              )}
              思考过程
            </button>
            {showReasoning && (
              <div
                className={cn(
                  "mt-1.5 pl-3 border-l-2 border-[var(--color-border)]",
                  "text-xs text-[var(--color-text-secondary)] whitespace-pre-wrap"
                )}
              >
                {reasoningContent}
              </div>
            )}
          </div>
        )}

        {/* 主要内容 */}
        <div
          className={cn(
            "text-sm leading-relaxed",
            isUser
              ? "bg-[var(--color-accent-muted)] text-[var(--color-text-primary)] px-3 py-2 rounded-[var(--radius-md)] max-w-[85%]"
              : "text-[var(--color-text-primary)]"
          )}
        >
          {content ? (
            <div
              className="prose-sm"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
            />
          ) : isStreaming ? (
            <span className="typing-cursor" />
          ) : null}

          {/* 流式输出光标 */}
          {isStreaming && content && (
            <span className="typing-cursor" />
          )}
        </div>

        {/* Token 计数 */}
        {tokenCount != null && (
          <span className="mt-1 text-[10px] font-mono text-[var(--color-text-tertiary)]">
            {tokenCount.toLocaleString()} tokens
          </span>
        )}
      </div>
    </div>
  );
}
