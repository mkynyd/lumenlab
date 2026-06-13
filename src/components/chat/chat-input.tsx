"use client";

import { useState } from "react";
import { Send, StopCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatInputProps {
  onSend: (message: string) => void;
  onStop?: () => void;
  isStreaming?: boolean;
  disabled?: boolean;
  value?: string;
  onValueChange?: (value: string) => void;
}

export function ChatInput({
  onSend,
  onStop,
  isStreaming = false,
  disabled = false,
  value,
  onValueChange,
}: ChatInputProps) {
  const [internalValue, setInternalValue] = useState("");
  const currentValue = value ?? internalValue;

  function updateValue(nextValue: string) {
    if (value === undefined) {
      setInternalValue(nextValue);
    }
    onValueChange?.(nextValue);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!currentValue.trim() || isStreaming || disabled) return;
    onSend(currentValue);
    updateValue("");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={cn(
        "flex items-end gap-2 p-3",
        "border-t border-[var(--color-border)]",
        "bg-[var(--color-surface)]"
      )}
    >
      <textarea
        value={currentValue}
        onChange={(e) => updateValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="输入消息…"
        rows={1}
        disabled={disabled}
        className={cn(
          "flex-1 resize-none max-h-32 py-2.5 px-3 text-sm",
          "rounded-[var(--radius-md)]",
          "border border-[var(--color-border)]",
          "bg-[var(--color-bg)] text-[var(--color-text-primary)]",
          "placeholder:text-[var(--color-text-tertiary)]",
          "focus:outline-none focus:border-[var(--color-accent)]",
          "transition-colors duration-150",
          "disabled:opacity-50"
        )}
        style={{ minHeight: "40px" }}
        onInput={(e) => {
          const el = e.currentTarget;
          el.style.height = "auto";
          el.style.height = Math.min(el.scrollHeight, 128) + "px";
        }}
      />

      {isStreaming ? (
        <button
          type="button"
          onClick={onStop}
          className={cn(
            "flex items-center justify-center w-10 h-10 shrink-0",
            "rounded-[var(--radius-md)]",
            "border border-[var(--color-error-muted)]",
            "bg-[var(--color-error-muted)] text-[var(--color-error)]",
            "hover:bg-[var(--color-error)] hover:text-white",
            "transition-colors duration-150"
          )}
          aria-label="停止生成"
        >
          <StopCircle size={18} strokeWidth={2} />
        </button>
      ) : (
        <button
          type="submit"
          disabled={!currentValue.trim() || disabled}
          className={cn(
            "flex items-center justify-center w-10 h-10 shrink-0",
            "rounded-[var(--radius-md)]",
            "bg-[var(--color-accent)] text-white",
            "hover:bg-[var(--color-accent-hover)]",
            "disabled:opacity-40 disabled:cursor-not-allowed",
            "transition-colors duration-150"
          )}
          aria-label="发送消息"
        >
          <Send size={18} strokeWidth={2} />
        </button>
      )}
    </form>
  );
}
