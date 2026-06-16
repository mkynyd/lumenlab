"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { MessageBubble } from "@/components/chat/message-bubble";
import type { ChatMessage } from "@/lib/hooks/use-chat";

type SaveArtifact = (input: {
  messageId: string;
  title: string;
  type: string;
  content: string;
}) => Promise<void>;

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

function Bubble({
  message,
  onSaveArtifact,
}: {
  message: ChatMessage;
  onSaveArtifact?: SaveArtifact;
}) {
  return (
    <MessageBubble
      id={message.id}
      role={message.role}
      content={message.content}
      reasoningContent={message.reasoningContent}
      tokenCount={message.tokenCount ?? undefined}
      isStreaming={message.isStreaming}
      onSaveArtifact={
        message.role === "assistant" ? onSaveArtifact : undefined
      }
    />
  );
}

/** Threshold in px — user is "at bottom" if within this distance from the end. */
const AT_BOTTOM_THRESHOLD = 64;

export function VirtualMessageList({
  messages,
  onSaveArtifact,
}: {
  messages: ChatMessage[];
  onSaveArtifact?: SaveArtifact;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const { completed, streaming } = splitStreamingMessage(messages);
  const userAtBottomRef = useRef(true);
  const prevMsgCountRef = useRef(messages.length);
  const [pinned, setPinned] = useState(false);

  const virtualizer = useVirtualizer({
    count: completed.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 120,
    getItemKey: (index) => completed[index].id,
    overscan: 5,
  });

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
      setPinned(!atBottom);
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [isNearBottom]);

  // Auto-scroll only when user is at the bottom
  useEffect(() => {
    const msgCountChanged = messages.length !== prevMsgCountRef.current;
    prevMsgCountRef.current = messages.length;

    if (messages.length === 0) return;

    // Always scroll to bottom for: initial load, user sent a new message
    if (msgCountChanged) {
      // New user message → always scroll to bottom
      scrollToBottom(false);
      return;
    }

    // Streaming content update → only scroll if user hasn't scrolled up
    if (streaming?.content && userAtBottomRef.current) {
      requestAnimationFrame(() => {
        if (userAtBottomRef.current) {
          scrollToBottom(false);
        }
      });
    }
  }, [messages.length, streaming?.content, scrollToBottom]);

  // Initial scroll to bottom on mount
  useEffect(() => {
    if (messages.length > 0) {
      requestAnimationFrame(() => scrollToBottom(false));
    }
    // Only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={parentRef} className="flex-1 overflow-y-auto">
      <div
        className="relative w-full"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualizer.getVirtualItems().map((item) => {
          const message = completed[item.index];
          return (
            <div
              key={message.id}
              ref={virtualizer.measureElement}
              data-index={item.index}
              className="absolute left-0 top-0 w-full"
              style={{ transform: `translateY(${item.start}px)` }}
            >
              <Bubble message={message} onSaveArtifact={onSaveArtifact} />
            </div>
          );
        })}
      </div>
      {streaming ? (
        <Bubble message={streaming} onSaveArtifact={onSaveArtifact} />
      ) : null}
      {pinned && (
        <button
          onClick={() => {
            scrollToBottom(true);
            setPinned(false);
            userAtBottomRef.current = true;
          }}
          className="fixed bottom-24 right-8 z-20 flex size-10 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg transition-opacity hover:bg-[var(--color-bg)]"
          aria-label="滚动到底部"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M4 6l4 4 4-4" />
          </svg>
        </button>
      )}
    </div>
  );
}
