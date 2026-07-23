"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@/lib/hooks/use-chat";
import { useWebSearch } from "@/lib/hooks/use-web-search";
import type { FileAttachment } from "@/lib/chat/router";
import { ChatInput } from "@/components/chat/chat-input";
import { VirtualMessageList } from "@/components/chat/virtual-message-list";
import { TokenUsageBar } from "@/components/chat/token-usage-bar";
import { AgentTimeline } from "@/components/chat/agent-timeline";
import { AgentRunStatus } from "@/components/chat/agent-run-status";
import { ContextBudgetWarning } from "@/components/chat/context-budget-warning";
import { AlertCircle } from "lucide-react";
import type { AgentEvent } from "@/lib/agent/types";
import type { AgentSource } from "@/lib/agent/sources";
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
  }>;
}

const AUTO_DISMISS_STATUSES = new Set<AgentEvent["type"]>([
  "tool_completed",
  "tool_failed",
  "tool_blocked",
  "approval_denied",
  "approval_expired",
]);

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
    agentTimeline,
    agentSession,
    approveExecution,
    rejectExecution,
    contextBudget,
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

  // Render the most recent awaiting/executing entry as a visible approval card.
  // Completed/failed entries briefly remain visible, then fade out and disappear.
  const visibleAgentEntries = Object.values(agentTimeline)
    .filter((entry) => entry.latestEvent.type !== "approval_granted")
    .sort((a, b) => {
      const order: Partial<Record<AgentEvent["type"], number>> = {
        approval_required: 0,
        tool_started: 1,
        tool_proposed: 2,
        tool_progress: 3,
        tool_completed: 4,
        tool_failed: 5,
        tool_blocked: 6,
        approval_granted: 7,
        approval_denied: 8,
        approval_expired: 9,
        skill_activated: 10,
        skill_deactivated: 11,
      };
      return (order[a.latestEvent.type] ?? 99) - (order[b.latestEvent.type] ?? 99);
    })
    .slice(-3);

  const [fadingAgentIds, setFadingAgentIds] = useState<Set<string>>(new Set());
  const [dismissedAgentIds, setDismissedAgentIds] = useState<Set<string>>(new Set());
  const scheduledDismissIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    const timers: NodeJS.Timeout[] = [];

    visibleAgentEntries.forEach((entry) => {
      if (!AUTO_DISMISS_STATUSES.has(entry.latestEvent.type)) return;
      if (scheduledDismissIds.current.has(entry.executionId)) return;

      scheduledDismissIds.current.add(entry.executionId);
      timers.push(
        setTimeout(() => {
          setFadingAgentIds((prev) => new Set([...prev, entry.executionId]));
        }, 3000),
        setTimeout(() => {
          setDismissedAgentIds((prev) => new Set([...prev, entry.executionId]));
        }, 3300)
      );
    });

    return () => {
      timers.forEach(clearTimeout);
    };
  }, [visibleAgentEntries]);

  const displayedAgentEntries = visibleAgentEntries.filter(
    (entry) => !dismissedAgentIds.has(entry.executionId)
  );
  const needsUserDecision = displayedAgentEntries.some(
    (entry) => entry.latestEvent.type === "approval_required"
  );

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
        <VirtualMessageList messages={messages} onSkillFollowUp={handleSkillFollowUp} />
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
          <AgentRunStatus
            plan={agentSession.plan}
            explanations={agentSession.explanations}
            needsUserDecision={needsUserDecision}
          />

          {/* Agent timeline：当前未完成 / 最近 3 条工具调用 */}
          {displayedAgentEntries.length > 0 && (
            <div className="max-h-72 space-y-1.5 overflow-y-auto px-4 pb-1 pt-2">
          {displayedAgentEntries.map((entry) => {
            const event = entry.latestEvent;
            const isFading = fadingAgentIds.has(entry.executionId);
            if (event.type === "approval_required") {
              return (
                <div
                  key={entry.executionId}
                  className={cn(
                    "transition-opacity duration-300",
                    isFading && "opacity-0"
                  )}
                >
                  <AgentTimeline
                    state={{
                      kind: "awaiting_user",
                      executionId: entry.executionId,
                      preview: event.preview,
                      token: entry.approvalToken ?? "",
                      expiresAt: entry.approvalExpiresAt ?? 0,
                      canApproveSession: event.canApproveSession,
                    }}
                    onApprove={async (executionId, token, scope) => {
                      await approveExecution(executionId, token, scope);
                    }}
                    onDeny={async (executionId) => {
                      await rejectExecution(executionId);
                    }}
                  />
                </div>
              );
            }
            if (event.type === "tool_proposed") {
              return (
                <div
                  key={entry.executionId}
                  className={cn(
                    "transition-opacity duration-300",
                    isFading && "opacity-0"
                  )}
                >
                  <AgentTimeline
                    state={{
                      kind: "proposed",
                      executionId: entry.executionId,
                      preview: event.preview,
                    }}
                  />
                </div>
              );
            }
            if (event.type === "tool_started") {
              return (
                <div
                  key={entry.executionId}
                  className={cn(
                    "transition-opacity duration-300",
                    isFading && "opacity-0"
                  )}
                >
                  <AgentTimeline
                    state={{
                      kind: "executing",
                      executionId: entry.executionId,
                    }}
                  />
                </div>
              );
            }
            if (event.type === "tool_completed") {
              return (
                <div
                  key={entry.executionId}
                  className={cn(
                    "transition-opacity duration-300",
                    isFading && "opacity-0"
                  )}
                >
                  <AgentTimeline
                    state={{
                      kind: "completed",
                      executionId: entry.executionId,
                      resultSummary: event.resultSummary,
                    }}
                  />
                </div>
              );
            }
            if (event.type === "tool_failed") {
              return (
                <div
                  key={entry.executionId}
                  className={cn(
                    "transition-opacity duration-300",
                    isFading && "opacity-0"
                  )}
                >
                  <AgentTimeline
                    state={{
                      kind: "failed",
                      executionId: entry.executionId,
                      error: event.error,
                    }}
                  />
                </div>
              );
            }
            if (event.type === "tool_blocked") {
              return (
                <div
                  key={entry.executionId}
                  className={cn(
                    "transition-opacity duration-300",
                    isFading && "opacity-0"
                  )}
                >
                  <AgentTimeline
                    state={{
                      kind: "failed",
                      executionId: entry.executionId,
                      error: event.reason,
                    }}
                  />
                </div>
              );
            }
            if (event.type === "approval_denied" || event.type === "approval_expired") {
              return (
                <div
                  key={entry.executionId}
                  className={cn(
                    "transition-opacity duration-300",
                    isFading && "opacity-0"
                  )}
                >
                  <AgentTimeline
                    state={{
                      kind: "denied",
                      executionId: entry.executionId,
                      reason:
                        event.type === "approval_expired"
                          ? "审批已过期"
                          : "用户拒绝",
                    }}
                  />
                </div>
              );
            }
            return null;
          })}
            </div>
          )}

          {composer}
        </>
      )}
    </div>
  );
}
