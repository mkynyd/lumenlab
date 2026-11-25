"use client";

import { createElement, useEffect, useRef, useState } from "react";
import { ArrowUp, Camera, ChevronRight, Globe, Image as ImageIcon, Paperclip, Plus, SlidersHorizontal, Sparkles, StopCircle, X } from "lucide-react";
import type { FileAttachment } from "@/lib/chat/router";
import {
  ACCEPT_ATTRIBUTE,
  extensionOf,
  IMAGE_EXTENSIONS,
  MAX_FILES_PER_REQUEST,
  MAX_TOTAL_SIZE,
  validateUploadFile,
} from "@/lib/files/allowed-extensions";
import { attachmentIconFor } from "@/lib/files/attachment-icon";
import { formatFileSize } from "@/lib/files/format-file-size";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ModelSelector } from "@/components/chat/model-selector";
import { SkillSelector, type SkillSelectorValue } from "@/components/chat/skill-selector";
import { useMeasuredTextareaHeight } from "@/lib/hooks/use-measured-textarea-height";
import { modelSupportsWebSearch } from "@/lib/chat/model-capabilities";
import { chatModelLabel, type ReasoningEffortLevel } from "@/lib/chat/model-catalog";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ChatInputProps {
  onSend: (message: string, attachments: FileAttachment[], onAccepted?: () => void) => void | boolean | Promise<void | boolean>;
  onStop?: () => void;
  isStreaming?: boolean;
  disabled?: boolean;
  value?: string;
  onValueChange?: (value: string) => void;
  attachments?: FileAttachment[];
  onAttachmentsChange?: (files: FileAttachment[]) => void;
  contextHint?: string;
  placeholder?: string;
  blockedReason?: string;
  model?: string;
  onModelChange?: (model: string) => void;
  reasoningEffort?: ReasoningEffortLevel;
  onReasoningEffortChange?: (effort: ReasoningEffortLevel) => void;
  availableModels?: readonly string[];
  webSearchActive?: boolean;
  onWebSearchToggle?: () => void;
  skillValue?: SkillSelectorValue;
  onSkillChange?: (value: SkillSelectorValue) => void;
}

function clipboardFile(file: File) {
  const extension = Object.keys(IMAGE_EXTENSIONS).find(
    (key) => IMAGE_EXTENSIONS[key] === file.type
  );
  if (!extension || IMAGE_EXTENSIONS[extensionOf(file.name)] === file.type) return file;
  return new File([file], `粘贴的图片.${extension}`, { type: file.type });
}

/**
 * 任务 08：上传期间的本地预览。图片用 blob URL 显示缩略图（随预览退出回收），
 * 其他附件保持文件名标签；文件名悬停浮层与类型图标见下方 hover 覆盖层。
 */
function AttachmentPreviewChip({
  attachment,
  onRemove,
}: {
  attachment: FileAttachment;
  onRemove: () => void;
}) {
  const isImage = attachment.mimeType.startsWith("image/");

  if (isImage) {
    return (
      <span
        className="group relative block size-16 overflow-hidden rounded-[var(--radius-md)] bg-[var(--color-panel-muted)]"
        title={`${attachment.name} · ${formatFileSize(attachment.size)}`}
      >
        {attachment.previewUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={attachment.previewUrl}
            alt={attachment.name}
            className="size-full object-cover"
          />
        )}
        <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-[var(--color-overlay)]/80 to-transparent px-1 pb-0.5 pt-3 text-[10px] leading-3 text-[var(--color-surface)] opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          {attachment.name}
        </span>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`移除附件 ${attachment.name}`}
          className="absolute right-0.5 top-0.5 flex size-5 items-center justify-center rounded-full bg-[var(--color-overlay)]/70 text-[var(--color-surface)] transition-colors hover:bg-[var(--color-overlay)]"
        >
          <X size={12} />
        </button>
      </span>
    );
  }

  return (
    <span
      className="inline-flex h-7 max-w-56 items-center gap-1 px-1.5 text-xs text-[var(--color-text-secondary)]"
      title={`${attachment.name} · ${formatFileSize(attachment.size)}`}
    >
      {createElement(attachmentIconFor(attachment.name, attachment.mimeType), {
        size: 12,
        className: "shrink-0 text-[var(--color-text-tertiary)]",
      })}
      <span className="truncate">{attachment.name}</span>
      <span className="shrink-0 text-[var(--color-text-tertiary)]">
        {formatFileSize(attachment.size)}
      </span>
      <button
        type="button"
        onClick={onRemove}
        className="text-[var(--color-text-tertiary)]"
        aria-label={`移除附件 ${attachment.name}`}
      >
        <X size={12} />
      </button>
    </span>
  );
}

export function ChatInput({
  onSend,
  onStop,
  isStreaming = false,
  disabled = false,
  value,
  onValueChange,
  attachments: controlledAttachments = [],
  onAttachmentsChange,
  contextHint,
  placeholder = "问点什么",
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  // 同步幂等闸：快速连按 Enter / 发送时，后续事件处理器读到的仍是 isSubmitting=false
  // 的旧闭包，state 挡不住重复入队，只能用 ref 在提交前同步拦截。
  const submittingRef = useRef(false);
  const mounted = useRef(true);
  // 附件默认受控（聊天页由父组件持有）；未提供 onAttachmentsChange 时
  // （如深度研究入口的 ResearchComposer）退化为内部状态，否则选中的文件会被静默丢弃。
  const [internalAttachments, setInternalAttachments] = useState<FileAttachment[]>([]);
  const attachments = onAttachmentsChange ? controlledAttachments : internalAttachments;
  const updateAttachments = onAttachmentsChange ?? setInternalAttachments;
  const attachmentsRef = useRef(attachments);
  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // 组件卸载时回收尚未发送的本地预览 URL。
      for (const attachment of attachmentsRef.current) {
        if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
      }
    };
  }, []);
  const latestDraft = useRef({ value: "", attachments });
  const [internalValue, setInternalValue] = useState("");
  const [inputFocused, setInputFocused] = useState(false);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const [mobileModelOpen, setMobileModelOpen] = useState(false);
  // 附件校验的非阻断提示：自动消隐，不阻塞输入与发送。
  const [attachmentNotice, setAttachmentNotice] = useState<string[]>([]);
  useEffect(() => {
    if (attachmentNotice.length === 0) return;
    const timer = setTimeout(() => setAttachmentNotice([]), 6000);
    return () => clearTimeout(timer);
  }, [attachmentNotice]);
  // 拖拽悬停覆盖层：用计数器避免子元素间的 dragenter/dragleave 抖动。
  const [isDragActive, setIsDragActive] = useState(false);
  const dragDepth = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const currentValue = value ?? internalValue;
  useEffect(() => {
    latestDraft.current = { value: currentValue, attachments };
  }, [currentValue, attachments]);
  const hasSendableContent = currentValue.trim().length > 0 || attachments.length > 0;
  const compactOnMobile = !inputFocused && !hasSendableContent && !isDragActive;
  const webSearchSupported = modelSupportsWebSearch(model);
  const { ref: textareaRef, style: textareaStyle } = useMeasuredTextareaHeight({
    value: currentValue,
    minHeight: 40,
    maxHeight: 160,
    fontSize: 16,
    lineHeight: 24,
    paddingX: 28,
    paddingY: 20,
    fontFamily: '"Noto Sans SC"',
  });

  function updateValue(nextValue: string) {
    if (value === undefined) {
      setInternalValue(nextValue);
    }
    onValueChange?.(nextValue);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!hasSendableContent || isStreaming || isSubmitting || disabled || blockedReason) return;
    if (submittingRef.current) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    let accepted = false;
    const onAccepted = () => {
      if (accepted || !mounted.current) return;
      accepted = true;
      if (latestDraft.current.value === currentValue) updateValue("");
      if (latestDraft.current.attachments === attachments) {
        for (const attachment of attachments) releasePreview(attachment);
        updateAttachments([]);
      }
    };
    try {
      const sent = await onSend(currentValue, attachments, onAccepted);
      if (sent !== false) onAccepted();
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  // 文件选择、拖拽、粘贴三条路径共用的唯一入口：逐个预校验 + 在单次上限内尽量接受。
  // 单个非法（类型 / 超过 50MB）或放不进单次上限（50 个 / 总 300MB）的文件单独
  // 拒绝并提示「哪份 + 上限」，其余合法文件保留，不整批丢弃。
  function addFiles(files: Iterable<File> | FileList | null) {
    if (!files) return;
    const incoming = Array.from(files);
    if (incoming.length === 0) return;
    const rejected: string[] = [];
    const accepted: File[] = [];
    for (const file of incoming) {
      const error = validateUploadFile(file);
      if (error) {
        rejected.push(`${file.name}: ${error}`);
      } else {
        accepted.push(file);
      }
    }
    if (accepted.length > 0) {
      const currentAttachments = attachmentsRef.current;
      // 按选择顺序在剩余数量与总大小额度内接受，放不下的逐份拒绝。
      let countLeft = Math.max(0, MAX_FILES_PER_REQUEST - currentAttachments.length);
      let sizeLeft = Math.max(
        0,
        MAX_TOTAL_SIZE - currentAttachments.reduce((sum, attachment) => sum + attachment.size, 0)
      );
      const kept: File[] = [];
      for (const file of accepted) {
        if (countLeft <= 0) {
          rejected.push(`${file.name}: 单次最多上传 ${MAX_FILES_PER_REQUEST} 个文件，未添加`);
          continue;
        }
        if (file.size > sizeLeft) {
          rejected.push(`${file.name}: 单次上传总大小超过 300MB 限制，未添加`);
          continue;
        }
        kept.push(file);
        countLeft -= 1;
        sizeLeft -= file.size;
      }
      if (kept.length > 0) {
        const nextFiles = kept.map((file) => {
          const mimeType = file.type || "application/octet-stream";
          const attachment: FileAttachment = {
            id:
              globalThis.crypto?.randomUUID?.() ||
              `attachment-${Date.now()}-${file.name}`,
            name: file.name,
            mimeType,
            size: file.size,
            data: file,
          };
          // 任务 08：本地预览 URL 在事件期创建，避免渲染期副作用与过早回收。
          if (mimeType.startsWith("image/")) {
            attachment.previewUrl = URL.createObjectURL(file);
          }
          return attachment;
        });
        const nextAttachments = [...currentAttachments, ...nextFiles];
        attachmentsRef.current = nextAttachments;
        updateAttachments(nextAttachments);
      }
    }
    if (rejected.length > 0) setAttachmentNotice(rejected);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const clipboard = e.clipboardData;
    if (!clipboard) return;
    const files = Array.from(clipboard.files ?? []);
    if (files.length === 0) {
      for (const item of Array.from(clipboard.items ?? [])) {
        if (item.kind !== "file") continue;
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length === 0) return;
    e.preventDefault();
    if (disabled || isStreaming) return;
    addFiles(files.map(clipboardFile));
  }

  function hasFilesInTransfer(dataTransfer: DataTransfer) {
    return Array.from(dataTransfer.types).includes("Files");
  }

  function handleDragEnter(e: React.DragEvent) {
    if (disabled || isStreaming || !hasFilesInTransfer(e.dataTransfer)) return;
    e.preventDefault();
    dragDepth.current += 1;
    setIsDragActive(true);
  }

  function handleDragOver(e: React.DragEvent) {
    if (disabled || isStreaming || !hasFilesInTransfer(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }

  function handleDragLeave(e: React.DragEvent) {
    if (!hasFilesInTransfer(e.dataTransfer)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setIsDragActive(false);
  }

  function handleDrop(e: React.DragEvent) {
    if (!hasFilesInTransfer(e.dataTransfer)) return;
    e.preventDefault();
    dragDepth.current = 0;
    setIsDragActive(false);
    if (disabled || isStreaming) return;
    addFiles(e.dataTransfer.files);
  }

  function releasePreview(attachment: FileAttachment) {
    if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
  }

  function removeAttachment(id: string) {
    for (const attachment of attachments) {
      if (attachment.id === id) releasePreview(attachment);
    }
    updateAttachments(attachments.filter((attachment) => attachment.id !== id));
  }

  return (
    <TooltipProvider>
      <Dialog open={mobileToolsOpen} onOpenChange={setMobileToolsOpen}>
      <form
        onSubmit={handleSubmit}
        autoComplete="off"
        className="mx-auto flex w-full max-w-[48rem] shrink-0 flex-col gap-2 bg-transparent px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 sm:px-4 sm:pb-4"
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
      {attachmentNotice.length > 0 && (
        <div
          role="status"
          aria-live="polite"
          className="flex min-h-7 flex-wrap items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-warning-muted)] px-2 py-1"
        >
          <span className="min-w-0 flex-1 text-xs text-[var(--color-warning)]">
            {attachmentNotice.map((notice) => (
              <span key={notice} className="mr-2 inline-block">
                {notice}
              </span>
            ))}
          </span>
          <button
            type="button"
            onClick={() => setAttachmentNotice([])}
            className="shrink-0 text-xs text-[var(--color-warning)]"
            aria-label="关闭附件提示"
          >
            <X size={12} />
          </button>
        </div>
      )}
      {contextHint && (
        <p className="truncate px-3 text-xs text-[var(--color-text-tertiary)]">
          {contextHint}
        </p>
      )}
      <div
        className="workbench-input-dock chat-composer relative bg-[var(--color-control)]"
        data-compact={compactOnMobile}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDragActive && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[var(--radius-xl)] bg-[var(--color-overlay)]/50"
          >
            <span className="text-sm font-medium text-[var(--color-surface)]">
              释放以上传文件
            </span>
          </div>
        )}
        {attachments.length > 0 && (
          <div className="chat-composer-attachments flex max-h-36 flex-wrap gap-1.5 overflow-y-auto px-3.5 pt-3">
            {attachments.map((attachment) => (
              <AttachmentPreviewChip
                key={attachment.id}
                attachment={attachment}
                onRemove={() => removeAttachment(attachment.id)}
              />
            ))}
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPT_ATTRIBUTE}
          className="hidden"
          onChange={(event) => addFiles(event.target.files)}
        />
        <input
          ref={photoInputRef}
          type="file"
          multiple
          accept="image/*"
          className="hidden"
          onChange={(event) => addFiles(event.target.files)}
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(event) => addFiles(event.target.files)}
        />
          <Textarea
            ref={textareaRef}
            aria-label="消息内容"
            value={currentValue}
            onChange={(e) => updateValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            placeholder={placeholder}
            rows={1}
            disabled={disabled}
            autoComplete="off"
            className={cn(
              "chat-composer-field block max-h-40 min-h-10 w-full resize-none field-sizing-fixed border-0 bg-transparent! px-3.5 pb-2 pt-2 text-base leading-6 shadow-none outline-none ring-0 focus:outline-none focus-visible:ring-0 md:min-h-14 md:pt-3",
              "text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)]",
              "focus:outline-none disabled:opacity-50"
            )}
            style={textareaStyle}
          />
        <div className="chat-composer-actions flex items-center gap-1.5">
          <DialogTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={disabled || isStreaming}
              className="size-11 shrink-0 rounded-full bg-[var(--color-panel-muted)] md:hidden"
              aria-label="更多输入选项"
            >
              <Plus />
            </Button>
          </DialogTrigger>
          {model && onModelChange && (
            <ModelSelector
              model={model}
              onChange={onModelChange}
              reasoningEffort={reasoningEffort}
              onReasoningEffortChange={onReasoningEffortChange}
              availableModels={availableModels}
              disabled={isStreaming || disabled}
              compact
              hideMobileTrigger
              mobileDialogOpen={mobileModelOpen}
              onMobileDialogOpenChange={setMobileModelOpen}
            />
          )}
          <div className="hidden min-w-0 items-center gap-1.5 md:flex">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  disabled={disabled || isStreaming}
                  onClick={() => fileInputRef.current?.click()}
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 rounded-[var(--radius-md)]"
                  aria-label="添加附件"
                >
                  <Paperclip />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">添加附件</TooltipContent>
            </Tooltip>
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
                      "shrink-0 rounded-[var(--radius-md)]",
                      webSearchActive && "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                    )}
                    aria-label={webSearchActive ? "关闭联网搜索" : "打开联网搜索"}
                    aria-pressed={webSearchActive}
                  >
                    <Globe strokeWidth={webSearchActive ? 2.5 : 2} />
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
                  size="icon-sm"
                  className="ml-auto size-11 shrink-0 rounded-full max-md:bg-clip-content max-md:p-1.5 md:size-8"
                  aria-label="停止生成"
                >
                  <StopCircle />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">停止生成</TooltipContent>
            </Tooltip>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="submit"
                  disabled={!hasSendableContent || disabled || isSubmitting || Boolean(blockedReason)}
                  variant="primary"
                  size="icon-sm"
                  className="ml-auto size-11 shrink-0 rounded-full max-md:bg-clip-content max-md:p-1.5 md:size-8"
                  aria-label="发送消息"
                >
                  <ArrowUp />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">发送消息</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
      </form>
        <DialogContent
          showCloseButton={false}
          className="chat-composer-sheet top-auto bottom-0 left-0 max-h-[85dvh] max-w-none -translate-x-0 -translate-y-0 gap-0 overflow-y-auto rounded-t-[24px] rounded-b-none border-0 p-0 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[var(--shadow-input)] sm:max-w-none"
          aria-describedby={undefined}
        >
          <div aria-hidden className="mx-auto mt-2 h-1 w-9 rounded-full bg-[var(--color-border-light)]" />
          <DialogHeader className="flex-row items-center justify-between gap-3 px-4 pb-1 pt-2">
            <DialogTitle className="text-[15px] font-semibold">添加来源</DialogTitle>
            <DialogClose asChild>
              <Button type="button" variant="ghost" size="icon-sm" className="size-9 rounded-full" aria-label="关闭添加来源">
                <X size={16} strokeWidth={1.8} />
              </Button>
            </DialogClose>
          </DialogHeader>
          <div className="px-2 pb-2">
            <div className="flex flex-col">
              <Button
                type="button"
                variant="ghost"
                disabled={disabled || isStreaming}
                onClick={() => {
                  setMobileToolsOpen(false);
                  cameraInputRef.current?.click();
                }}
                className="h-12 justify-start gap-3 rounded-[10px] px-3 text-[13px] font-normal"
              >
                <Camera size={18} strokeWidth={1.8} className="text-[var(--color-text-secondary)]" />
                拍照
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={disabled || isStreaming}
                onClick={() => {
                  setMobileToolsOpen(false);
                  photoInputRef.current?.click();
                }}
                className="h-12 justify-start gap-3 rounded-[10px] px-3 text-[13px] font-normal"
              >
                <ImageIcon size={18} strokeWidth={1.8} className="text-[var(--color-text-secondary)]" />
                照片
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={disabled || isStreaming}
                onClick={() => {
                  setMobileToolsOpen(false);
                  fileInputRef.current?.click();
                }}
                className="h-12 justify-start gap-3 rounded-[10px] px-3 text-[13px] font-normal"
              >
                <Paperclip size={18} strokeWidth={1.8} className="text-[var(--color-text-secondary)]" />
                文件
              </Button>
            </div>
            {(onWebSearchToggle || onSkillChange || (model && onModelChange)) && (
              <div className="my-2 h-px bg-[var(--color-border-light)]" />
            )}
            {model && onModelChange && (
              <Button
                type="button"
                variant="ghost"
                disabled={disabled || isStreaming}
                onClick={() => {
                  setMobileToolsOpen(false);
                  window.setTimeout(() => setMobileModelOpen(true), 260);
                }}
                className="h-12 w-full justify-start gap-3 rounded-[10px] px-3 text-[13px] font-normal"
              >
                <SlidersHorizontal size={18} strokeWidth={1.8} className="text-[var(--color-text-secondary)]" />
                <span className="flex-1 text-left">模型与思考</span>
                <span className="max-w-[45%] truncate text-[var(--color-text-tertiary)]">
                  {chatModelLabel(model)} · {reasoningEffort === "low" ? "低" : reasoningEffort === "high" ? "高" : "最高"}
                </span>
                <ChevronRight size={15} strokeWidth={1.8} className="shrink-0 text-[var(--color-text-tertiary)]" />
              </Button>
            )}
            {onWebSearchToggle && webSearchSupported && (
              <Button
                type="button"
                variant="ghost"
                disabled={disabled || isStreaming}
                onClick={onWebSearchToggle}
                aria-pressed={webSearchActive}
                className={cn(
                  "h-12 w-full justify-start gap-3 rounded-[10px] px-3 text-[13px] font-normal",
                  webSearchActive && "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                )}
              >
                <Globe size={18} strokeWidth={1.8} />
                <span className="flex-1 text-left">联网搜索</span>
                <span className="text-[var(--color-text-tertiary)]">
                  {webSearchActive ? "已开启" : "已关闭"}
                </span>
              </Button>
            )}
            {onSkillChange && (
              <div className="flex h-12 items-center gap-3 rounded-[10px] px-3">
                <Sparkles size={18} strokeWidth={1.8} className="text-[var(--color-text-secondary)]" />
                <span className="flex-1 text-[13px] text-[var(--color-text-primary)]">智能方式</span>
                <SkillSelector
                  value={skillValue}
                  onChange={onSkillChange}
                  disabled={isStreaming || disabled}
                  compact={false}
                />
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>    </TooltipProvider>
  );
}
