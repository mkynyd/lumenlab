"use client";

import { createElement, useCallback, useEffect, useRef, useState } from "react";
import { Download, ImageOff, Minus, Plus, RotateCcw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { ChatAttachmentDto } from "@/lib/chat/message-attachments";
import { attachmentIconFor } from "@/lib/files/attachment-icon";
import { formatFileSize } from "@/lib/files/format-file-size";
import { cn } from "@/lib/utils";

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const SCALE_STEP = 0.5;

interface ViewerState {
  index: number;
  scale: number;
  offset: { x: number; y: number };
}

function aspectRatio(attachment: ChatAttachmentDto): string | undefined {
  if (!attachment.width || !attachment.height) return undefined;
  return `${attachment.width} / ${attachment.height}`;
}

function isPdfAttachment(attachment: ChatAttachmentDto): boolean {
  return attachment.kind === "file" && attachment.mimeType === "application/pdf";
}

function AttachmentThumbnail({
  attachment,
  onOpen,
}: {
  attachment: ChatAttachmentDto;
  onOpen: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const uploading = attachment.status === "uploading";

  if (failed) {
    return (
      <div
        className="flex h-20 w-28 flex-col items-center justify-center gap-1 rounded-[var(--radius-md)] bg-[var(--color-panel-muted)] px-2 text-center text-[11px] text-[var(--color-text-tertiary)]"
        title={attachment.name}
      >
        <ImageOff size={14} />
        <span className="line-clamp-2 break-all">{attachment.name}</span>
        <span>图片不可访问</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      title={`查看 ${attachment.name}`}
      aria-label={`查看图片 ${attachment.name}`}
      className="group relative block max-w-full overflow-hidden rounded-[var(--radius-md)] bg-[var(--color-panel-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={attachment.thumbnailUrl}
        alt={attachment.name}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        style={{ aspectRatio: aspectRatio(attachment) }}
        className="max-h-64 w-auto max-w-full object-contain transition-opacity group-hover:opacity-90"
      />
      {uploading && (
        <span className="absolute inset-0 flex items-center justify-center bg-[var(--color-overlay)]/40">
          <Spinner className="size-4" />
        </span>
      )}
    </button>
  );
}

function VideoThumbnail({
  attachment,
  onOpen,
}: {
  attachment: ChatAttachmentDto;
  onOpen: () => void;
}) {
  const uploading = attachment.status === "uploading";

  return (
    <button
      type="button"
      onClick={onOpen}
      title={`查看 ${attachment.name}`}
      aria-label={`查看视频 ${attachment.name}`}
      className="group relative block max-w-full overflow-hidden rounded-[var(--radius-md)] bg-[var(--color-panel-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
    >
      <video
        src={attachment.thumbnailUrl}
        preload="metadata"
        muted
        playsInline
        className="max-h-64 w-auto max-w-full object-contain transition-opacity group-hover:opacity-90"
      />
      {uploading && (
        <span className="absolute inset-0 flex items-center justify-center bg-[var(--color-overlay)]/40">
          <Spinner className="size-4" />
        </span>
      )}
    </button>
  );
}

function AttachmentFileCard({
  attachment,
  onOpenPreview,
}: {
  attachment: ChatAttachmentDto;
  onOpenPreview: () => void;
}) {
  const uploading = attachment.status === "uploading";
  const isPdf = isPdfAttachment(attachment);

  const content = (
    <>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-interaction-hover)] text-[var(--color-text-secondary)]">
        {createElement(attachmentIconFor(attachment.name, attachment.mimeType), {
          size: 18,
        })}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm">{attachment.name}</span>
        <span className="text-xs text-[var(--color-text-tertiary)]">
          {formatFileSize(attachment.size)}
        </span>
      </span>
    </>
  );

  const rowClass =
    "flex min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-md)] px-1.5 py-1.5";

  return (
    <div className="relative">
      <div
        className={cn(
          "flex items-center gap-1 rounded-[var(--radius-md)] bg-[var(--color-panel-muted)] p-1 transition-colors",
          uploading
            ? "opacity-60"
            : "hover:bg-[var(--color-interaction-hover)]"
        )}
      >
        {uploading ? (
          // 上传中还没有可用的 URL：渲染成非交互行，避免出现 href="" 的假链接。
          <span className={rowClass}>{content}</span>
        ) : isPdf ? (
          <button
            type="button"
            onClick={onOpenPreview}
            title={`预览 ${attachment.name}`}
            aria-label={`预览 ${attachment.name}`}
            className={cn(rowClass, "text-left")}
          >
            {content}
          </button>
        ) : (
          <a
            href={attachment.url}
            target="_blank"
            rel="noreferrer"
            title={`打开 ${attachment.name}`}
            aria-label={`打开 ${attachment.name}`}
            className={rowClass}
          >
            {content}
          </a>
        )}
        {!uploading && (
          <Button asChild variant="ghost" size="icon-sm">
            <a
              href={attachment.url}
              download={attachment.name}
              aria-label={`下载 ${attachment.name}`}
            >
              <Download size={14} />
            </a>
          </Button>
        )}
      </div>
      {uploading && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Spinner className="size-4" />
        </span>
      )}
    </div>
  );
}

function AttachmentViewer({
  attachments,
  state,
  onStateChange,
  onClose,
}: {
  attachments: ChatAttachmentDto[];
  state: ViewerState;
  onStateChange: (next: ViewerState) => void;
  onClose: () => void;
}) {
  const current = attachments[state.index];
  const isVideo = current?.kind === "video";
  const isPdf = Boolean(current) && isPdfAttachment(current);
  // 缩放/平移/滚轮/双指只对图片有效；视频与 PDF 隐藏相关控件与手势。
  const canZoom = Boolean(current) && !isVideo && !isPdf;
  const [failedId, setFailedId] = useState<string | null>(null);
  const failed = Boolean(current) && failedId === current.id;
  const dragRef = useRef<{ pointerId: number; x: number; y: number } | null>(
    null
  );
  const pinchRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStartRef = useRef<{ distance: number; scale: number } | null>(null);

  const reset = useCallback(
    () => onStateChange({ index: state.index, scale: 1, offset: { x: 0, y: 0 } }),
    [onStateChange, state.index]
  );

  const changeScale = useCallback(
    (delta: number) => {
      if (!canZoom) return;
      const scale = Math.min(
        MAX_SCALE,
        Math.max(MIN_SCALE, Number((state.scale + delta).toFixed(2)))
      );
      onStateChange({
        index: state.index,
        scale,
        offset: scale === 1 ? { x: 0, y: 0 } : state.offset,
      });
    },
    [canZoom, onStateChange, state]
  );

  const step = useCallback(
    (delta: number) => {
      if (attachments.length < 2) return;
      const index =
        (state.index + delta + attachments.length) % attachments.length;
      onStateChange({ index, scale: 1, offset: { x: 0, y: 0 } });
    },
    [attachments.length, onStateChange, state.index]
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "ArrowRight") {
        event.preventDefault();
        step(1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        step(-1);
      } else if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        changeScale(SCALE_STEP);
      } else if (event.key === "-") {
        event.preventDefault();
        changeScale(-SCALE_STEP);
      } else if (event.key === "0") {
        event.preventDefault();
        reset();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [changeScale, reset, step]);

  if (!current) return null;

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent
        aria-describedby={undefined}
        className="h-[92vh] max-w-[96vw] gap-0 p-0 sm:max-w-[92vw]"
      >
        <DialogTitle className="sr-only">
          附件查看器：{current.name}
        </DialogTitle>

        <div className="flex shrink-0 items-center gap-2 px-4 py-2.5 pr-14">
          <span className="min-w-0 flex-1 truncate text-xs text-[var(--color-text-secondary)]">
            {current.name}
            {attachments.length > 1 && (
              <span className="ml-2 text-[var(--color-text-tertiary)]">
                {state.index + 1} / {attachments.length}
              </span>
            )}
          </span>
          {canZoom && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="缩小"
                disabled={state.scale <= MIN_SCALE}
                onClick={() => changeScale(-SCALE_STEP)}
              >
                <Minus size={14} />
              </Button>
              <span className="w-12 text-center font-mono text-xs text-[var(--color-text-tertiary)]">
                {Math.round(state.scale * 100)}%
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="放大"
                disabled={state.scale >= MAX_SCALE}
                onClick={() => changeScale(SCALE_STEP)}
              >
                <Plus size={14} />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="重置缩放"
                onClick={reset}
              >
                <RotateCcw size={14} />
              </Button>
            </>
          )}
          <a
            href={current.url}
            target="_blank"
            rel="noreferrer"
            className="rounded-[var(--radius-md)] px-2 py-1 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-interaction-hover)]"
          >
            {isVideo || isPdf ? "打开原文件" : "查看原图"}
          </a>
        </div>

        <div
          className={cn(
            "flex min-h-0 flex-1 items-center justify-center overflow-hidden px-2 pb-2",
            canZoom && state.scale > 1
              ? "cursor-grab active:cursor-grabbing"
              : undefined
          )}
          style={{ touchAction: canZoom ? "none" : undefined }}
          onWheel={
            canZoom
              ? (event) => {
                  event.preventDefault();
                  changeScale(event.deltaY > 0 ? -SCALE_STEP : SCALE_STEP);
                }
              : undefined
          }
          onPointerDown={
            canZoom
              ? (event) => {
                  (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
                  pinchRef.current.set(event.pointerId, {
                    x: event.clientX,
                    y: event.clientY,
                  });
                  if (pinchRef.current.size === 2) {
                    const [a, b] = [...pinchRef.current.values()];
                    pinchStartRef.current = {
                      distance: Math.hypot(a.x - b.x, a.y - b.y),
                      scale: state.scale,
                    };
                  } else if (state.scale > 1) {
                    dragRef.current = {
                      pointerId: event.pointerId,
                      x: event.clientX - state.offset.x,
                      y: event.clientY - state.offset.y,
                    };
                  }
                }
              : undefined
          }
          onPointerMove={
            canZoom
              ? (event) => {
                  if (pinchRef.current.has(event.pointerId)) {
                    pinchRef.current.set(event.pointerId, {
                      x: event.clientX,
                      y: event.clientY,
                    });
                  }
                  const pinch = pinchStartRef.current;
                  if (pinch && pinchRef.current.size === 2) {
                    const [a, b] = [...pinchRef.current.values()];
                    const distance = Math.hypot(a.x - b.x, a.y - b.y);
                    if (pinch.distance > 0) {
                      const scale = Math.min(
                        MAX_SCALE,
                        Math.max(
                          MIN_SCALE,
                          Number(
                            ((pinch.scale * distance) / pinch.distance).toFixed(2)
                          )
                        )
                      );
                      onStateChange({ index: state.index, scale, offset: state.offset });
                    }
                    return;
                  }
                  const drag = dragRef.current;
                  if (!drag || drag.pointerId !== event.pointerId) return;
                  onStateChange({
                    index: state.index,
                    scale: state.scale,
                    offset: {
                      x: event.clientX - drag.x,
                      y: event.clientY - drag.y,
                    },
                  });
                }
              : undefined
          }
          onPointerUp={
            canZoom
              ? (event) => {
                  pinchRef.current.delete(event.pointerId);
                  if (pinchRef.current.size < 2) pinchStartRef.current = null;
                  if (dragRef.current?.pointerId === event.pointerId) {
                    dragRef.current = null;
                  }
                }
              : undefined
          }
          onPointerCancel={
            canZoom
              ? (event) => {
                  pinchRef.current.delete(event.pointerId);
                  if (pinchRef.current.size < 2) pinchStartRef.current = null;
                  dragRef.current = null;
                }
              : undefined
          }
          onDoubleClick={
            canZoom
              ? () =>
                  onStateChange({
                    index: state.index,
                    scale: state.scale > 1 ? 1 : 2,
                    offset: { x: 0, y: 0 },
                  })
              : undefined
          }
        >
          {failed ? (
            <div className="flex flex-col items-center gap-2 text-sm text-[var(--color-text-secondary)]">
              <ImageOff size={20} />
              <span>图片已不可访问</span>
              <span className="text-xs text-[var(--color-text-tertiary)]">
                {current.name}
              </span>
            </div>
          ) : isVideo ? (
            <video
              controls
              autoPlay
              src={current.url}
              className="max-h-full max-w-full"
            />
          ) : isPdf ? (
            <iframe
              src={current.url}
              title={current.name}
              className="h-full w-full"
            />
          ) : (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={current.url}
              alt={current.name}
              draggable={false}
              onError={() => setFailedId(current.id)}
              style={{
                transform: `translate(${state.offset.x}px, ${state.offset.y}px) scale(${state.scale})`,
              }}
              className="max-h-full max-w-full select-none object-contain transition-transform duration-75"
            />
          )}
        </div>

        {attachments.length > 1 && (
          <div className="flex shrink-0 items-center justify-center gap-1.5 px-4 pb-3">
            {attachments.map((attachment, index) => (
              <button
                key={attachment.id}
                type="button"
                aria-label={`查看第 ${index + 1} 个附件`}
                aria-current={index === state.index}
                onClick={() =>
                  onStateChange({
                    index,
                    scale: 1,
                    offset: { x: 0, y: 0 },
                  })
                }
                className={cn(
                  "size-2 rounded-full transition-colors",
                  index === state.index
                    ? "bg-[var(--color-accent)]"
                    : "bg-[var(--color-panel-muted)] hover:bg-[var(--color-interaction-hover)]"
                )}
              />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * 用户消息附件：图片/视频进入媒体网格（单张原始比例、多张网格），文件以
 * 卡片列表堆叠在网格下方；点击打开查看器（键盘、Escape、图片滚轮/双指缩放）。
 * 上传中的附件显示半透明遮罩与 spinner；图片不可访问时显示占位说明。
 */
export function MessageAttachments({
  attachments,
}: {
  attachments: ChatAttachmentDto[];
}) {
  const [viewer, setViewer] = useState<ViewerState | null>(null);
  const [viewerItems, setViewerItems] = useState<ChatAttachmentDto[]>([]);

  if (attachments.length === 0) return null;

  // 按 kind 分组且各自保持 position 顺序：媒体进网格，文件进卡片列表。
  const mediaAttachments = attachments.filter((a) => a.kind !== "file");
  const fileAttachments = attachments.filter((a) => a.kind === "file");

  const openViewer = (items: ChatAttachmentDto[], index: number) => {
    setViewerItems(items);
    setViewer({ index, scale: 1, offset: { x: 0, y: 0 } });
  };

  return (
    <>
      {mediaAttachments.length > 0 && (
        <div
          className={cn(
            "mb-1.5 flex justify-end",
            mediaAttachments.length === 1
              ? ""
              : "grid max-w-[min(100%,28rem)] grid-cols-2 gap-1.5 sm:grid-cols-3"
          )}
        >
          {mediaAttachments.map((attachment, index) =>
            attachment.kind === "video" ? (
              <VideoThumbnail
                key={attachment.id}
                attachment={attachment}
                onOpen={() => openViewer(mediaAttachments, index)}
              />
            ) : (
              <AttachmentThumbnail
                key={attachment.id}
                attachment={attachment}
                onOpen={() => openViewer(mediaAttachments, index)}
              />
            )
          )}
        </div>
      )}
      {fileAttachments.length > 0 && (
        <div className="mb-1.5 flex w-full max-w-sm flex-col gap-1.5">
          {fileAttachments.map((attachment) => (
            <AttachmentFileCard
              key={attachment.id}
              attachment={attachment}
              onOpenPreview={() => openViewer([attachment], 0)}
            />
          ))}
        </div>
      )}
      {viewer && (
        <AttachmentViewer
          attachments={viewerItems}
          state={viewer}
          onStateChange={setViewer}
          onClose={() => setViewer(null)}
        />
      )}
    </>
  );
}
