"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import { MessageBubble } from "@/components/chat/message-bubble";
import type { ChatMessage } from "@/lib/hooks/use-chat";
import type { ApprovalScope } from "@/lib/agent/types";

type SaveArtifact = (input: {
  messageId: string;
  title: string;
  type: string;
  content: string;
}) => Promise<void>;

type SkillFollowUp = (skillId: string) => void;

export function splitStreamingMessage(messages: ChatMessage[]) {
  const last = messages.at(-1);
  if (last?.isStreaming) {
    return {
      completed: messages.slice(0, -1),
      streaming: last,
    };
  }
  return { completed: messages, streaming: undefined };
}

const Bubble = memo(function Bubble({
  message,
  onSaveArtifact,
  onSkillFollowUp,
  onApproveTool,
  onDenyTool,
}: {
  message: ChatMessage;
  onSaveArtifact?: SaveArtifact;
  onSkillFollowUp?: SkillFollowUp;
  onApproveTool?: (executionId: string, token: string, scope: ApprovalScope) => Promise<void> | void;
  onDenyTool?: (executionId: string) => Promise<void> | void;
}) {
  return (
    <MessageBubble
      id={message.id}
      role={message.role}
      content={message.content}
      reasoningContent={message.reasoningContent}
      tokenCount={message.tokenCount ?? undefined}
      sources={message.sources}
      attachments={message.attachments}
      isStreaming={message.isStreaming}
      activeToolId={message.activeToolId}
      toolsUsed={message.toolsUsed}
      process={message.process}
      onSaveArtifact={
        message.role === "assistant" ? onSaveArtifact : undefined
      }
      onSkillFollowUp={
        message.role === "assistant" ? onSkillFollowUp : undefined
      }
      onApproveTool={message.role === "assistant" ? onApproveTool : undefined}
      onDenyTool={message.role === "assistant" ? onDenyTool : undefined}
    />
  );
});

/** 显示「滚动到底部」按钮的阈值：离底部超过这个距离就提示用户。 */
const AT_BOTTOM_THRESHOLD = 64;
/**
 * 继续跟随流式输出的阈值：必须真正贴底（几像素以内）才跟随。
 * 用户向上滚一点点就立刻停止跟随，不再被新内容拉回底部。
 */
const FOLLOW_BOTTOM_THRESHOLD = 4;

export function VirtualMessageList({
  messages,
  onSaveArtifact,
  onSkillFollowUp,
  onApproveTool,
  onDenyTool,
}: {
  messages: ChatMessage[];
  onSaveArtifact?: SaveArtifact;
  onSkillFollowUp?: SkillFollowUp;
  onApproveTool?: (executionId: string, token: string, scope: ApprovalScope) => Promise<void> | void;
  onDenyTool?: (executionId: string) => Promise<void> | void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const lastMessage = messages.at(-1);
  const lastContent = lastMessage?.content ?? "";
  const userAtBottomRef = useRef(true);
  const prevMsgCountRef = useRef(messages.length);
  const [pinned, setPinned] = useState(false);
  const pinnedRef = useRef(false);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = parentRef.current;
    if (!el) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: smooth ? "smooth" : "instant",
    });
  }, []);

  // 用户主动滚动/触摸时立即解除跟随，不等 scroll 事件；重新贴底后才恢复跟随。
  // 这样流式输出不会把用户刚滑上去的阅读位置一行一行推回底部。
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;

    const release = () => {
      userAtBottomRef.current = false;
    };
    const handleScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      userAtBottomRef.current = distance <= FOLLOW_BOTTOM_THRESHOLD;
      const nextPinned = distance > AT_BOTTOM_THRESHOLD;
      if (pinnedRef.current !== nextPinned) {
        pinnedRef.current = nextPinned;
        setPinned(nextPinned);
      }
    };

    el.addEventListener("scroll", handleScroll, { passive: true });
    el.addEventListener("wheel", release, { passive: true });
    el.addEventListener("touchmove", release, { passive: true });
    el.addEventListener("keydown", release);
    return () => {
      el.removeEventListener("scroll", handleScroll);
      el.removeEventListener("wheel", release);
      el.removeEventListener("touchmove", release);
      el.removeEventListener("keydown", release);
    };
  }, []);

  // 只有用户仍贴着底部时才跟随内容增长；用户主动滚动后完全不干预位置。
  useLayoutEffect(() => {
    const msgCountChanged = messages.length !== prevMsgCountRef.current;
    prevMsgCountRef.current = messages.length;

    if (messages.length === 0) return;

    if (msgCountChanged) {
      userAtBottomRef.current = true;
      if (pinnedRef.current) {
        pinnedRef.current = false;
        setPinned(false);
      }
      scrollToBottom(false);
      return;
    }

    if (userAtBottomRef.current) {
      scrollToBottom(false);
    }
  }, [lastContent, messages.length, scrollToBottom]);

  // Initial scroll to bottom on mount
  useLayoutEffect(() => {
    if (messages.length > 0) {
      scrollToBottom(false);
    }
    // Only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto bg-[var(--color-bg)] pb-4">
      {messages.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-sm font-medium text-[var(--color-text-primary)]">
            开始一段对话
          </p>
          <p className="max-w-sm text-xs leading-5 text-[var(--color-text-tertiary)]">
            在下方输入你的问题或任务，AI 会结合当前项目资料给出回答。附件、快捷任务和上下文都从这里发起。
          </p>
        </div>
      ) : null}
      <div className="w-full">
        {messages.map((message) => (
          <Bubble
            key={message.id}
            message={message}
            onSaveArtifact={onSaveArtifact}
            onSkillFollowUp={onSkillFollowUp}
            onApproveTool={onApproveTool}
            onDenyTool={onDenyTool}
          />
        ))}
      </div>
      {pinned && (
        <button
          onClick={() => {
            scrollToBottom(true);
            pinnedRef.current = false;
            setPinned(false);
            userAtBottomRef.current = true;
          }}
          className="fixed bottom-28 right-5 z-20 flex size-10 items-center justify-center rounded-full border border-[var(--color-border-light)] bg-[var(--color-control)] text-[var(--color-text-secondary)] transition-[background-color,color,transform] duration-150 hover:bg-[var(--color-interaction-hover)] hover:text-[var(--color-text-primary)] active:scale-[0.97] sm:right-8"
          aria-label="滚动到底部"
        >
          <ArrowDown size={16} strokeWidth={2} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
