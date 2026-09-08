"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ImageOff, Minus, Plus, RotateCcw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { ChatAttachmentDto } from "@/lib/chat/message-attachments";
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
    [onStateChange, state]
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
          图片查看器：{current.name}
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
          <a
            href={current.url}
            target="_blank"
            rel="noreferrer"
            className="rounded-[var(--radius-md)] px-2 py-1 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-interaction-hover)]"
          >
            查看原图
          </a>
        </div>

        <div
          className={cn(
            "flex min-h-0 flex-1 items-center justify-center overflow-hidden px-2 pb-2",
            state.scale > 1 ? "cursor-grab active:cursor-grabbing" : undefined
          )}
          style={{ touchAction: "none" }}
          onWheel={(event) => {
            event.preventDefault();
            changeScale(event.deltaY > 0 ? -SCALE_STEP : SCALE_STEP);
          }}
          onPointerDown={(event) => {
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
          }}
          onPointerMove={(event) => {
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
          }}
          onPointerUp={(event) => {
            pinchRef.current.delete(event.pointerId);
            if (pinchRef.current.size < 2) pinchStartRef.current = null;
            if (dragRef.current?.pointerId === event.pointerId) {
              dragRef.current = null;
            }
          }}
          onPointerCancel={(event) => {
            pinchRef.current.delete(event.pointerId);
            if (pinchRef.current.size < 2) pinchStartRef.current = null;
            dragRef.current = null;
          }}
          onDoubleClick={() =>
            onStateChange({
              index: state.index,
              scale: state.scale > 1 ? 1 : 2,
              offset: { x: 0, y: 0 },
            })
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
                aria-label={`查看第 ${index + 1} 张图片`}
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
 * 任务 08.4/08.5：用户消息里的图片附件。
 * 单张按原始比例、多张网格；点击打开查看器（键盘、Escape、滚轮/双指缩放）。
 * 图片不可访问时显示占位说明，不展示空白破图。
 */
export function MessageAttachments({
  attachments,
}: {
  attachments: ChatAttachmentDto[];
}) {
  const [viewer, setViewer] = useState<ViewerState | null>(null);
  if (attachments.length === 0) return null;

  return (
    <>
      <div
        className={cn(
          "mb-1.5 flex justify-end",
          attachments.length === 1
            ? ""
            : "grid max-w-[min(100%,28rem)] grid-cols-2 gap-1.5 sm:grid-cols-3"
        )}
      >
        {attachments.map((attachment, index) => (
          <AttachmentThumbnail
            key={attachment.id}
            attachment={attachment}
            onOpen={() =>
              setViewer({ index, scale: 1, offset: { x: 0, y: 0 } })
            }
          />
        ))}
      </div>
      {viewer && (
        <AttachmentViewer
          attachments={attachments}
          state={viewer}
          onStateChange={setViewer}
          onClose={() => setViewer(null)}
        />
      )}
    </>
  );
}
