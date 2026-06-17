"use client";

import { useRef, useState } from "react";
import { FileText, Paperclip, Send, StopCircle, X } from "lucide-react";
import type { FileAttachment } from "@/lib/chat/router";
import { cn } from "@/lib/utils";

interface ChatInputProps {
  onSend: (message: string, attachments: FileAttachment[]) => void;
  onStop?: () => void;
  isStreaming?: boolean;
  disabled?: boolean;
  value?: string;
  onValueChange?: (value: string) => void;
  attachments?: FileAttachment[];
  onAttachmentsChange?: (files: FileAttachment[]) => void;
  contextHint?: string;
  blockedReason?: string;
}

export function ChatInput({
  onSend,
  onStop,
  isStreaming = false,
  disabled = false,
  value,
  onValueChange,
  attachments = [],
  onAttachmentsChange,
  blockedReason,
}: ChatInputProps) {
  const [internalValue, setInternalValue] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const currentValue = value ?? internalValue;
  const hasSendableContent = currentValue.trim().length > 0 || attachments.length > 0;

  function updateValue(nextValue: string) {
    if (value === undefined) {
      setInternalValue(nextValue);
    }
    onValueChange?.(nextValue);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!hasSendableContent || isStreaming || disabled) return;
    onSend(currentValue, attachments);
    updateValue("");
    onAttachmentsChange?.([]);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const nextFiles = Array.from(files).map((file) => ({
      id: globalThis.crypto?.randomUUID?.() || `attachment-${Date.now()}-${file.name}`,
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      data: file,
    }));
    onAttachmentsChange?.([...attachments, ...nextFiles]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function removeAttachment(id: string) {
    onAttachmentsChange?.(attachments.filter((attachment) => attachment.id !== id));
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={cn(
        "workbench-input-dock flex flex-col gap-2 border-t border-[var(--color-border-light)] bg-[var(--color-panel)] p-3 backdrop-blur-[var(--glass-blur)]"
      )}
    >
      {blockedReason && (
        <div
          className={cn(
            "flex min-h-7 flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] border px-2 py-1",
            blockedReason
              ? "border-[var(--color-warning-muted)] bg-[var(--color-warning-muted)] text-[var(--color-warning)]"
              : "border-[var(--color-border-light)] bg-[var(--color-surface)] text-[var(--color-text-secondary)]"
          )}
        >
          <span className="min-w-0 truncate text-[11px]">
            {blockedReason}
          </span>
        </div>
      )}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {attachments.map((attachment) => (
            <span
              key={attachment.id}
              className="inline-flex h-7 max-w-56 items-center gap-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs"
              title={`${attachment.name} · ${(attachment.size / 1024).toFixed(1)} KB`}
            >
              <FileText size={12} className="shrink-0 text-[var(--color-text-tertiary)]" />
              <span className="truncate">{attachment.name}</span>
              <button
                type="button"
                onClick={() => removeAttachment(attachment.id)}
                className="rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] hover:text-[var(--color-error)]"
                aria-label={`移除附件 ${attachment.name}`}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div
        className={cn(
	          "flex items-end gap-2 rounded-[var(--radius-xl)] border border-[var(--color-border-light)] bg-[var(--color-surface)] p-1.5 shadow-[var(--shadow-panel)]",
	          "focus-within:border-[var(--color-accent)] focus-within:ring-2 focus-within:ring-[var(--color-accent-muted)]"
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => addFiles(event.target.files)}
        />
        <button
          type="button"
          disabled={disabled || isStreaming}
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            "flex items-center justify-center w-9 h-9 shrink-0",
	            "rounded-[var(--radius-lg)]",
            "border border-[var(--color-border-light)]",
            "bg-[var(--color-panel-muted)] text-[var(--color-text-secondary)]",
            "hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]",
            "disabled:opacity-40 disabled:cursor-not-allowed",
            "transition-colors duration-150"
          )}
          aria-label="添加附件"
          title="添加附件"
        >
          <Paperclip size={17} strokeWidth={2} />
        </button>
        <textarea
          value={currentValue}
          onChange={(e) => updateValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入问题，或让 AI 基于当前资料生成实验报告、复习提纲、代码说明"
          rows={1}
          disabled={disabled}
          className={cn(
            "flex-1 resize-none max-h-32 border-0 bg-transparent px-1 py-2 text-sm",
            "text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)]",
            "focus:outline-none disabled:opacity-50"
          )}
          style={{ minHeight: "36px" }}
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
              "flex items-center justify-center w-9 h-9 shrink-0",
              "rounded-[var(--radius-lg)]",
              "border border-[var(--color-error-muted)]",
              "bg-[var(--color-error-muted)] text-[var(--color-error)]",
              "hover:bg-[var(--color-error)] hover:text-[var(--color-accent-contrast)]",
              "transition-colors duration-150"
            )}
            aria-label="停止生成"
          >
            <StopCircle size={17} strokeWidth={2} />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!hasSendableContent || disabled}
            className={cn(
              "flex items-center justify-center w-9 h-9 shrink-0",
              "rounded-[var(--radius-lg)]",
              "bg-[var(--color-accent)] text-[var(--color-accent-contrast)]",
              "hover:bg-[var(--color-accent-hover)]",
              "disabled:opacity-40 disabled:cursor-not-allowed",
              "transition-colors duration-150"
            )}
            aria-label="发送消息"
          >
            <Send size={17} strokeWidth={2} />
          </button>
        )}
      </div>
    </form>
  );
}
