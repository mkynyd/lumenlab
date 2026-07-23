"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import { MessageBubble } from "@/components/chat/message-bubble";
import type { ChatMessage } from "@/lib/hooks/use-chat";

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
}: {
  message: ChatMessage;
  onSaveArtifact?: SaveArtifact;
  onSkillFollowUp?: SkillFollowUp;
}) {
  return (
    <MessageBubble
      id={message.id}
      role={message.role}
      content={message.content}
      reasoningContent={message.reasoningContent}
      tokenCount={message.tokenCount ?? undefined}
      sources={message.sources}
      isStreaming={message.isStreaming}
      onSaveArtifact={
        message.role === "assistant" ? onSaveArtifact : undefined
      }
      onSkillFollowUp={
        message.role === "assistant" ? onSkillFollowUp : undefined
      }
    />
  );
});

/** Threshold in px — user is "at bottom" if within this distance from the end. */
const AT_BOTTOM_THRESHOLD = 64;

export function VirtualMessageList({
  messages,
  onSaveArtifact,
  onSkillFollowUp,
}: {
  messages: ChatMessage[];
  onSaveArtifact?: SaveArtifact;
  onSkillFollowUp?: SkillFollowUp;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const { completed, streaming } = splitStreamingMessage(messages);
  const userAtBottomRef = useRef(true);
  const prevMsgCountRef = useRef(messages.length);
  const [pinned, setPinned] = useState(false);
  const pinnedRef = useRef(false);

  const isNearBottom = useCallback(() => {
    const el = parentRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight <= AT_BOTTOM_THRESHOLD;
  }, []);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = parentRef.current;
    if (!el) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: smooth ? "smooth" : "instant",
    });
  }, []);

  // Handle scroll events from the user
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const handleScroll = () => {
      if (!el) return;
      const atBottom = isNearBottom();
      userAtBottomRef.current = atBottom;
      const nextPinned = !atBottom;
      if (pinnedRef.current !== nextPinned) {
        pinnedRef.current = nextPinned;
        setPinned(nextPinned);
      }
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [isNearBottom]);

  // Auto-scroll only when user is at the bottom
  useLayoutEffect(() => {
    const msgCountChanged = messages.length !== prevMsgCountRef.current;
    prevMsgCountRef.current = messages.length;

    if (messages.length === 0) return;

    if (msgCountChanged) {
      scrollToBottom(false);
      userAtBottomRef.current = true;
      if (pinnedRef.current) {
        pinnedRef.current = false;
        setPinned(false);
      }
      return;
    }

    // Streaming content update → only scroll if user hasn't scrolled up
    if (streaming?.content && userAtBottomRef.current) {
      scrollToBottom(false);
    }
  }, [messages.length, streaming?.content, scrollToBottom]);

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
        {completed.map((message) => (
          <Bubble
            key={message.id}
            message={message}
            onSaveArtifact={onSaveArtifact}
            onSkillFollowUp={onSkillFollowUp}
          />
        ))}
      </div>
      {streaming ? (
        <Bubble message={streaming} onSaveArtifact={onSaveArtifact} onSkillFollowUp={onSkillFollowUp} />
      ) : null}
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
