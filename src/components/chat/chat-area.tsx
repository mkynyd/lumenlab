"use client";

import { useEffect, useMemo, useState } from "react";
import { useChat } from "@/lib/hooks/use-chat";
import { useWebSearch } from "@/lib/hooks/use-web-search";
import type { FileAttachment } from "@/lib/chat/router";
import { ChatInput } from "@/components/chat/chat-input";
import { VirtualMessageList } from "@/components/chat/virtual-message-list";
import { onNewChat } from "@/lib/chat/new-chat-event";
import { TokenUsageBar } from "@/components/chat/token-usage-bar";
import { ContextBudgetWarning } from "@/components/chat/context-budget-warning";
import { AlertCircle } from "lucide-react";
import type { AgentSource } from "@/lib/agent/sources";
import type { AssistantProcessTrace } from "@/lib/agent/assistant-process";
import type { SkillSelectorValue } from "@/components/chat/skill-selector";
import { cn } from "@/lib/utils";
import { effectiveWebSearchActive, modelSupportsWebSearch } from "@/lib/chat/model-capabilities";

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
    sources?: AgentSource[] | null;
    process?: AssistantProcessTrace;
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
    availableModels,
    reasoningEffort,
    setModel,
    setReasoningEffort,
    sendMessage,
    abort,
    clearError,
    agentSession,
    approveExecution,
    rejectExecution,
    contextBudget,
    newConversation,
  } = useChat({
    initialConversationId,
    initialMessages: initialMessages?.map((m) => ({
      ...m,
      role: m.role as "user" | "assistant" | "system",
    })),
  });
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [userSkillValue, setUserSkillValue] = useState<SkillSelectorValue>("auto");
  const { webSearchActive, toggle: toggleWebSearch } = useWebSearch();

  // 侧边栏「+」：URL 被 replaceState 改写时 router.push("/chat") 是 no-op，
  // 订阅新对话事件原地重置会话状态。
  useEffect(() => onNewChat(newConversation), [newConversation]);
  const canUseWebSearch = modelSupportsWebSearch(model);
  const sendWithWebSearch = effectiveWebSearchActive(model, webSearchActive);

  useEffect(() => {
    if (!canUseWebSearch && webSearchActive) {
      toggleWebSearch();
    }
  }, [canUseWebSearch, toggleWebSearch, webSearchActive]);

  // The selector reflects the user's manual choice when they picked one;
  // otherwise it tracks the skill the server reported as active.
  const skillValue: SkillSelectorValue = useMemo(() => {
    if (userSkillValue !== "auto") return userSkillValue;
    if (agentSession.activeSkill) return agentSession.activeSkill.skillId as SkillSelectorValue;
    return "auto";
  }, [userSkillValue, agentSession.activeSkill]);

  const handleSkillChange = (value: SkillSelectorValue) => {
    setUserSkillValue(value);
  };

  const handleSend = (content: string, files: FileAttachment[]) => {
    const input: Parameters<typeof sendMessage>[0] = {
      content,
      attachments: files,
      webSearchActive: sendWithWebSearch,
    };
    if (skillValue === "off") {
      input.skillOff = true;
    } else if (skillValue !== "auto") {
      input.manualSkillId = skillValue;
    }
    void sendMessage(input);
  };

  const handleSkillFollowUp = (skillId: string) => {
    setUserSkillValue(skillId as SkillSelectorValue);
    void sendMessage({
      content: "继续",
      manualSkillId: skillId,
      webSearchActive: sendWithWebSearch,
    });
  };

  const composer = (
    <ChatInput
      onSend={handleSend}
      onStop={abort}
      isStreaming={isStreaming}
      attachments={attachments}
      onAttachmentsChange={setAttachments}
      model={model}
      onModelChange={setModel}
      availableModels={availableModels}
      reasoningEffort={reasoningEffort}
      onReasoningEffortChange={setReasoningEffort}
      webSearchActive={sendWithWebSearch}
      onWebSearchToggle={toggleWebSearch}
      skillValue={skillValue}
      onSkillChange={handleSkillChange}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--color-bg)]">
      {/* 错误提示 */}
      {error && (
        <div
          className={cn(
            "flex items-center gap-2 px-4 py-2 mx-4 mt-2 rounded-[var(--radius-md)]",
            "bg-[var(--color-error-muted)]",
            "text-sm text-[var(--color-error)]"
          )}
        >
          <AlertCircle size={14} strokeWidth={2} className="shrink-0" />
          <span className="flex-1">{error}</span>
          <button
            onClick={clearError}
            className="rounded-md px-1.5 py-0.5 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] focus-visible:bg-[var(--color-error-muted)] focus-visible:text-[var(--color-error)]"
          >
            关闭
          </button>
        </div>
      )}

      {/* 上下文预算警告 */}
      <ContextBudgetWarning contextBudget={contextBudget} />

      {messages.length === 0 ? (
        <div className="flex min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex min-h-full w-full max-w-[52rem] flex-col justify-center px-1 pb-[10vh] pt-8 sm:px-4">
            <div className="mb-5 px-5 text-center sm:mb-6">
              <h1 className="text-[1.65rem] font-semibold tracking-[-0.035em] text-[var(--color-text-primary)] sm:text-[2rem]">
                今天想一起完成什么？
              </h1>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--color-text-tertiary)]">
                提问、上传资料，或选择一种学习方式开始。
              </p>
            </div>
            {composer}
          </div>
        </div>
      ) : (
        <VirtualMessageList
          messages={messages}
          onSkillFollowUp={handleSkillFollowUp}
          onApproveTool={approveExecution}
          onDenyTool={rejectExecution}
        />
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

      {messages.length > 0 && (
        <>
          {composer}
        </>
      )}
    </div>
  );
}
