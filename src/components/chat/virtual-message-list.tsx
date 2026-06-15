"use client";

import { useEffect, useRef } from "react";
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

export function VirtualMessageList({
  messages,
  onSaveArtifact,
}: {
  messages: ChatMessage[];
  onSaveArtifact?: SaveArtifact;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const { completed, streaming } = splitStreamingMessage(messages);
  const virtualizer = useVirtualizer({
    count: completed.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 120,
    getItemKey: (index) => completed[index].id,
    overscan: 5,
  });

  useEffect(() => {
    const element = parentRef.current;
    if (!element || messages.length === 0) return;
    requestAnimationFrame(() => {
      element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
    });
  }, [messages.length, streaming?.content]);

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
    </div>
  );
}
