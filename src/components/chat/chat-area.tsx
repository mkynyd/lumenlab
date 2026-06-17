"use client";

import { useState } from "react";
import { useChat } from "@/lib/hooks/use-chat";
import type { FileAttachment } from "@/lib/chat/router";
import { ChatInput } from "@/components/chat/chat-input";
import { VirtualMessageList } from "@/components/chat/virtual-message-list";
import { ModelSelector } from "@/components/chat/model-selector";
import { TokenUsageBar } from "@/components/chat/token-usage-bar";
import { ContextRing } from "@/components/chat/context-ring";
import { CostDisplay } from "@/components/chat/cost-display";
import { Switch } from "@/components/ui/switch";
import { AmbientField } from "@/components/workbench/ambient-field";
import { AlertCircle, Hash } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatAreaProps {
  initialConversationId?: string;
  initialMessages?: Array<{
    id: string;
    role: string;
    content: string;
    reasoningContent?: string | null;
    tokenCount?: number | null;
    cacheHitTokens?: number | null;
    cacheMissTokens?: number | null;
  }>;
}

export function ChatArea({
  initialConversationId,
  initialMessages,
}: ChatAreaProps) {
  const {
    messages,
    isStreaming,
    error,
    usage,
    model,
    thinkingEnabled,
    setModel,
    setThinkingEnabled,
    sendMessage,
    abort,
    clearError,
  } = useChat({
    initialConversationId,
    initialMessages: initialMessages?.map((m) => ({
      ...m,
      role: m.role as "user" | "assistant" | "system",
    })),
  });
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);

  // 计算 Token 总数
  const totalTokens = messages.reduce(
    (sum, m) => sum + (m.tokenCount || 0),
    0
  );
  const totalInputTokens =
    usage?.promptTokens || Math.round(totalTokens * 0.4);
  const totalOutputTokens =
    usage?.completionTokens || Math.round(totalTokens * 0.6);

  return (
    <div className="flex flex-col h-full bg-[var(--color-bg)]">
      {/* 顶部模型切换栏 */}
      <div
        className={cn(
          "flex min-h-14 items-center justify-between gap-3 px-4 py-2",
          "border-b border-[var(--color-border-light)]",
          "bg-[var(--color-panel)] shrink-0 backdrop-blur-[var(--glass-blur)]"
        )}
      >
        <div className="flex items-center gap-3">
          <ModelSelector model={model} onChange={setModel} disabled={isStreaming} />
          <Switch
            checked={thinkingEnabled}
            onChange={setThinkingEnabled}
            label="思考模式"
          />
        </div>

        {usage && (
          <div className="hidden md:flex items-center gap-4">
            <ContextRing used={usage.totalTokens} />
            <CostDisplay
              inputTokens={totalInputTokens}
              outputTokens={totalOutputTokens}
              cacheHitTokens={usage.cacheHitTokens}
              cacheMissTokens={usage.cacheMissTokens}
              model={model as "deepseek-v4-pro" | "deepseek-v4-flash"}
            />
          </div>
        )}
      </div>

      {/* 错误提示 */}
      {error && (
        <div
          className={cn(
            "flex items-center gap-2 px-4 py-2 mx-4 mt-2 rounded-[var(--radius-md)]",
            "bg-[var(--color-error-muted)] border border-[var(--color-error)]/20",
            "text-sm text-[var(--color-error)]"
          )}
        >
          <AlertCircle size={14} strokeWidth={2} className="shrink-0" />
          <span className="flex-1">{error}</span>
          <button
            onClick={clearError}
            className="text-xs underline hover:no-underline"
          >
            关闭
          </button>
        </div>
      )}

      {/* 消息列表 */}
      {messages.length === 0 ? (
        <div className="relative flex-1 overflow-y-auto">
          <AmbientField density="wide" className="opacity-75" />
          <div className="relative flex h-full flex-col items-center justify-center px-4 text-center">
            <div
              className={cn(
                "mb-4 flex h-12 w-12 items-center justify-center rounded-[var(--radius-lg)]",
                "border border-[var(--color-border)]",
                "bg-[var(--color-panel)] shadow-[var(--shadow-panel)]"
              )}
            >
              <Hash size={24} strokeWidth={1.5} className="text-[var(--color-text-tertiary)]" />
            </div>
            <h2 className="mb-2 text-lg font-semibold text-[var(--color-text-primary)]">
              开始对话
            </h2>
            <p className="max-w-sm text-sm leading-relaxed text-[var(--color-text-secondary)]">
              选择一个模型，切换思考模式，然后发送消息即可与 DeepSeek 开始对话。
            </p>
          </div>
        </div>
      ) : (
        <VirtualMessageList messages={messages} />
      )}

      {/* Token 用量条（移动端底部显示） */}
      {usage && (
        <div className="px-4 py-1.5 border-t border-[var(--color-border-light)] md:hidden">
          <TokenUsageBar
            used={usage.totalTokens}
            cacheHit={usage.cacheHitTokens}
          />
        </div>
      )}

      {/* 输入框 */}
      <ChatInput
        onSend={(content, files) => void sendMessage({ content, attachments: files })}
        onStop={abort}
        isStreaming={isStreaming}
        attachments={attachments}
        onAttachmentsChange={setAttachments}
        contextHint="普通对话模式，未绑定项目资料"
      />
    </div>
  );
}
