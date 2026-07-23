"use client";

import { useRef, useState } from "react";
import { FileText, Globe, Paperclip, Plus, Send, StopCircle, X } from "lucide-react";
import type { FileAttachment } from "@/lib/chat/router";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ModelSelector } from "@/components/chat/model-selector";
import { SkillSelector, type SkillSelectorValue } from "@/components/chat/skill-selector";
import { useMeasuredTextareaHeight } from "@/lib/hooks/use-measured-textarea-height";
import { modelSupportsWebSearch } from "@/lib/chat/model-capabilities";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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
  model?: string;
  onModelChange?: (model: string) => void;
  reasoningEffort?: "high" | "max";
  onReasoningEffortChange?: (effort: "high" | "max") => void;
  availableModels?: readonly string[];
  webSearchActive?: boolean;
  onWebSearchToggle?: () => void;
  skillValue?: SkillSelectorValue;
  onSkillChange?: (value: SkillSelectorValue) => void;
}

const MOBILE_MODEL_OPTIONS = [
  { value: "deepseek-v4-flash", label: "快速" },
  { value: "deepseek-v4-pro", label: "深度" },
  { value: "minimax-m3", label: "MiniMax" },
  { value: "qwen3.7-plus", label: "Qwen" },
] as const;

export function ChatInput({
  onSend,
  onStop,
  isStreaming = false,
  disabled = false,
  value,
  onValueChange,
  attachments = [],
  onAttachmentsChange,
  contextHint,
  blockedReason,
  model,
  onModelChange,
  reasoningEffort,
  onReasoningEffortChange,
  availableModels,
  webSearchActive = false,
  onWebSearchToggle,
  skillValue = "auto",
  onSkillChange,
}: ChatInputProps) {
  const [internalValue, setInternalValue] = useState("");
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const currentValue = value ?? internalValue;
  const hasSendableContent = currentValue.trim().length > 0 || attachments.length > 0;
  const webSearchSupported = modelSupportsWebSearch(model);
  const { ref: textareaRef, style: textareaStyle } = useMeasuredTextareaHeight({
    value: currentValue,
    minHeight: 40,
    maxHeight: 160,
    fontSize: 16,
    lineHeight: 24,
    fontFamily: '"Noto Sans SC"',
  });

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

  function selectMobileModel(nextModel: string) {
    onModelChange?.(nextModel);
    onReasoningEffortChange?.(
      nextModel === "deepseek-v4-flash" ? "high" : "max"
    );
  }

  const mobileModels = MOBILE_MODEL_OPTIONS.filter((option) =>
    (availableModels ?? MOBILE_MODEL_OPTIONS.map((item) => item.value)).includes(option.value)
  );

  return (
    <TooltipProvider>
      <form
        onSubmit={handleSubmit}
        autoComplete="off"
        className={cn(
          "mx-auto w-full max-w-[48rem] shrink-0 space-y-2 bg-transparent px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 sm:px-4 sm:pb-4"
        )}
      >
      {blockedReason && (
        <div
          className={cn(
            "flex min-h-7 flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] px-2 py-1",
            blockedReason
              ? "bg-[var(--color-warning-muted)] text-[var(--color-warning)]"
              : "bg-[var(--color-surface)] text-[var(--color-text-secondary)]"
          )}
        >
          <span className="min-w-0 truncate text-xs">
            {blockedReason}
          </span>
        </div>
      )}
      <div
        className={cn(
          "workbench-input-dock rounded-[28px] border border-[var(--color-border-light)] bg-[var(--color-control)] p-1.5 sm:p-2",
          "outline-none ring-0 transition-[border-color,box-shadow] duration-200 focus-within:border-[var(--color-border)] motion-reduce:transition-none"
        )}
      >
        {attachments.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-1.5 px-1">
            {attachments.map((attachment) => (
              <span
                key={attachment.id}
                className="inline-flex h-7 max-w-56 items-center gap-1 rounded-[var(--radius-md)] bg-[var(--color-panel-muted)] px-2 text-xs"
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
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => addFiles(event.target.files)}
        />
        {contextHint && (
          <p className="mb-0.5 truncate px-2 text-xs text-[var(--color-text-tertiary)]">
            {contextHint}
          </p>
        )}
        <div className="flex items-end gap-1 sm:block">
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            disabled={disabled || isStreaming}
            onClick={() => setMobileToolsOpen(true)}
            className="size-11 rounded-full sm:hidden"
            aria-label="更多输入选项"
            aria-expanded={mobileToolsOpen}
          >
            <Plus size={20} strokeWidth={2} />
          </Button>
          <Textarea
            ref={textareaRef}
            aria-label="消息内容"
            value={currentValue}
            onChange={(e) => updateValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="问点什么"
            rows={1}
            disabled={disabled}
            autoComplete="off"
            className={cn(
              "max-h-40 min-h-11 flex-1 resize-none border-0 bg-transparent px-1.5 py-2.5 text-base leading-6 shadow-none outline-none ring-0 focus:outline-none focus-visible:ring-0 sm:px-2 sm:py-2",
              "text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)]",
              "focus:outline-none disabled:opacity-50"
            )}
            style={textareaStyle}
          />
          <div className="hidden sm:block">
          <div className="mt-1.5 flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  disabled={disabled || isStreaming}
                  onClick={() => fileInputRef.current?.click()}
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 rounded-full"
                  aria-label="添加附件"
                >
                  <Paperclip size={17} strokeWidth={2} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">添加附件</TooltipContent>
            </Tooltip>
            {model && onModelChange && (
              <ModelSelector
                model={model}
                onChange={onModelChange}
                reasoningEffort={reasoningEffort}
                onReasoningEffortChange={onReasoningEffortChange}
                availableModels={availableModels}
                disabled={isStreaming || disabled}
                compact
              />
            )}
            {onSkillChange && (
              <SkillSelector
                value={skillValue}
                onChange={onSkillChange}
                disabled={isStreaming || disabled}
                compact
              />
            )}
            {onWebSearchToggle && webSearchSupported && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={onWebSearchToggle}
                    disabled={isStreaming || disabled}
                    className={cn(
                      "shrink-0 rounded-full",
                      webSearchActive && "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                    )}
                    aria-label={webSearchActive ? "关闭联网搜索" : "打开联网搜索"}
                    aria-pressed={webSearchActive}
                  >
                    <Globe size={17} strokeWidth={webSearchActive ? 2.5 : 2} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {webSearchActive ? "关闭联网搜索" : "联网搜索"}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          {isStreaming ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  onClick={onStop}
                  variant="destructive"
                  size="icon-lg"
                  className="shrink-0 rounded-full"
                  aria-label="停止生成"
                >
                  <StopCircle size={17} strokeWidth={2} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">停止生成</TooltipContent>
            </Tooltip>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="submit"
                  disabled={!hasSendableContent || disabled}
                  variant="primary"
                  size="icon-lg"
                  className="shrink-0 rounded-full"
                  aria-label="发送消息"
                >
                  <Send size={17} strokeWidth={2} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">发送消息</TooltipContent>
            </Tooltip>
          )}
        </div>
          </div>
          <div className="sm:hidden">
            {isStreaming ? (
              <Button
                type="button"
                onClick={onStop}
                variant="destructive"
                size="icon-lg"
                className="size-11 rounded-full"
                aria-label="停止生成"
              >
                <StopCircle size={18} strokeWidth={2} />
              </Button>
            ) : (
              <Button
                type="submit"
                disabled={!hasSendableContent || disabled}
                variant="primary"
                size="icon-lg"
                className="size-11 rounded-full"
                aria-label="发送消息"
              >
                <Send size={18} strokeWidth={2} />
              </Button>
            )}
          </div>
        </div>
      </div>
      <Dialog open={mobileToolsOpen} onOpenChange={setMobileToolsOpen}>
        <DialogContent
          showCloseButton={false}
          className="top-auto bottom-0 left-0 max-w-none -translate-x-0 -translate-y-0 gap-3 rounded-t-[20px] rounded-b-none border-x-0 border-b-0 p-3 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-none sm:hidden"
        >
          <DialogHeader className="flex-row items-center justify-between gap-3">
            <DialogTitle>对话选项</DialogTitle>
            <DialogClose asChild>
              <Button type="button" variant="ghost" size="icon-sm" className="size-11" aria-label="关闭对话选项">
                <X size={16} />
              </Button>
            </DialogClose>
          </DialogHeader>
          <div className="flex flex-col gap-1">
            <Button
              type="button"
              variant="ghost"
              disabled={disabled || isStreaming}
              onClick={() => {
                setMobileToolsOpen(false);
                fileInputRef.current?.click();
              }}
              className="h-11 justify-start rounded-[var(--radius-md)] px-3 font-normal"
            >
              <Paperclip data-icon="inline-start" size={18} strokeWidth={2} />
              文件
            </Button>
            {onWebSearchToggle && webSearchSupported && (
              <Button
                type="button"
                variant="ghost"
                disabled={disabled || isStreaming}
                onClick={() => {
                  onWebSearchToggle();
                  setMobileToolsOpen(false);
                }}
                className={cn(
                  "h-12 justify-start rounded-[var(--radius-md)] px-3",
                  webSearchActive && "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                )}
              >
                <Globe data-icon="inline-start" size={18} strokeWidth={2} />
                联网
              </Button>
            )}
          </div>
          {model && onModelChange && mobileModels.length > 0 && (
            <div className="space-y-2">
              <p className="px-1 text-xs text-[var(--color-text-tertiary)]">模型</p>
              <div className="flex flex-col gap-1">
                {mobileModels.map((option) => (
                  <Button
                    key={option.value}
                    type="button"
                    variant="ghost"
                    disabled={disabled || isStreaming}
                    onClick={() => {
                      selectMobileModel(option.value);
                      setMobileToolsOpen(false);
                    }}
                    className={cn(
                      "h-11 justify-start rounded-[var(--radius-md)] px-3 font-normal",
                      model === option.value && "bg-[var(--color-interaction-active)] text-[var(--color-text-primary)]"
                    )}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {onSkillChange && (
            <div className="flex min-h-12 items-center justify-between gap-3 border-t border-[var(--color-border-light)] px-3 pt-2">
              <span className="text-sm text-[var(--color-text-secondary)]">智能方式</span>
              <SkillSelector
                value={skillValue}
                onChange={(nextValue) => {
                  onSkillChange(nextValue);
                  setMobileToolsOpen(false);
                }}
                disabled={isStreaming || disabled}
                compact={false}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
      </form>
    </TooltipProvider>
  );
}
