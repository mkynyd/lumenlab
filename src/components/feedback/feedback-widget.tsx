"use client";

import { useEffect, useRef, useState } from "react";
import { MessageSquarePlus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const CATEGORIES = [
  { value: "bug", label: "Bug" },
  { value: "suggestion", label: "功能建议" },
  { value: "other", label: "其他" },
] as const;

type Category = (typeof CATEGORIES)[number]["value"];

const POSITION_STORAGE_KEY = "feedback-widget-pos";
const VIEWPORT_MARGIN = 8;
const EDGE_SNAP_OFFSET = 12;
const DRAG_THRESHOLD_PX = 6;

type Position = { x: number; y: number };

function clampToViewport(pos: Position, width: number, height: number): Position {
  const maxX = Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN);
  const maxY = Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN);
  return {
    x: Math.min(Math.max(pos.x, VIEWPORT_MARGIN), maxX),
    y: Math.min(Math.max(pos.y, VIEWPORT_MARGIN), maxY),
  };
}

export function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<Category>("bug");
  const [content, setContent] = useState("");
  const [contact, setContact] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [state, setState] = useState<"idle" | "success" | "error">("idle");
  // null = 使用 CSS 类默认定位（SSR 与首帧一致，避免 hydration 不匹配）
  const [position, setPosition] = useState<Position | null>(null);
  const [dragging, setDragging] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<{
    startClientX: number;
    startClientY: number;
    originX: number;
    originY: number;
    width: number;
    height: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(POSITION_STORAGE_KEY);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        typeof (parsed as Position).x === "number" &&
        typeof (parsed as Position).y === "number" &&
        Number.isFinite((parsed as Position).x) &&
        Number.isFinite((parsed as Position).y)
      ) {
        const rect = buttonRef.current?.getBoundingClientRect();
        setPosition(
          clampToViewport(parsed as Position, rect?.width ?? 0, rect?.height ?? 0)
        );
      }
    } catch {
      // 存储内容损坏时忽略，回落到默认定位
    }
  }, []);

  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    dragRef.current = {
      startClientX: event.clientX,
      startClientY: event.clientY,
      originX: rect.left,
      originY: rect.top,
      width: rect.width,
      height: rect.height,
      moved: false,
    };
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // jsdom 等环境下 pointer capture 不可用，忽略
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.startClientX;
    const dy = event.clientY - drag.startClientY;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      drag.moved = true;
      setDragging(true);
    }
    setPosition(
      clampToViewport(
        { x: drag.originX + dx, y: drag.originY + dy },
        drag.width,
        drag.height
      )
    );
  };

  const endDrag = (snap: boolean) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || !drag.moved) return;
    setDragging(false);
    if (!snap) return;
    // 拖动后的那次 click 必须吞掉，避免拖完弹出 dialog
    suppressClickRef.current = true;
    setPosition((current) => {
      const base = current ?? { x: drag.originX, y: drag.originY };
      const snappedX =
        base.x + drag.width / 2 < window.innerWidth / 2
          ? EDGE_SNAP_OFFSET
          : window.innerWidth - drag.width - EDGE_SNAP_OFFSET;
      const next = clampToViewport(
        { x: snappedX, y: base.y },
        drag.width,
        drag.height
      );
      try {
        localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // 存储不可用时忽略
      }
      return next;
    });
  };

  const handleClickCapture = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (!suppressClickRef.current) return;
    suppressClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  const reset = () => {
    setCategory("bug");
    setContent("");
    setContact("");
    setState("idle");
  };

  const submit = async () => {
    if (!content.trim() || submitting) return;
    setSubmitting(true);
    setState("idle");
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          content: content.trim(),
          contact: contact.trim() || undefined,
          pagePath: window.location.pathname,
        }),
      });
      if (response.status < 200 || response.status >= 300) {
        throw new Error(String(response.status));
      }
      setState("success");
      setContent("");
      setContact("");
    } catch {
      setState("error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <button
          ref={buttonRef}
          type="button"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={() => endDrag(true)}
          onPointerCancel={() => endDrag(false)}
          onClickCapture={handleClickCapture}
          style={position ? { left: position.x, top: position.y } : undefined}
          className={cn(
            "fixed z-30 inline-flex h-9 touch-none items-center gap-1.5 rounded-full bg-[var(--color-panel-muted)] px-4 text-sm text-[var(--color-text-secondary)] transition-[background-color,color,transform] duration-150 select-none hover:bg-[var(--color-interaction-active)] hover:text-[var(--color-text-primary)] active:scale-[0.97]",
            dragging ? "cursor-grabbing" : "cursor-grab",
            !position && "right-4 bottom-16 sm:right-6 sm:bottom-6"
          )}
        >
          <MessageSquarePlus className="size-4" aria-hidden />
          反馈
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>问题反馈</DialogTitle>
          <DialogDescription>
            遇到的问题或想要的功能，直接告诉我们。当前页面信息会自动附上。
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2" role="group" aria-label="反馈类型">
          {CATEGORIES.map((item) => (
            <button
              key={item.value}
              type="button"
              aria-pressed={category === item.value}
              onClick={() => setCategory(item.value)}
              className={cn(
                "h-8 rounded-[var(--radius-md)] px-3 text-sm transition-[background-color,color] duration-150",
                category === item.value
                  ? "bg-[var(--color-interaction-active)] font-medium text-[var(--color-text-primary)]"
                  : "text-[var(--color-text-secondary)] hover:bg-[var(--color-interaction-hover)]"
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="feedback-content" className="text-sm">
            问题描述
          </label>
          <Textarea
            id="feedback-content"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            maxLength={2000}
            rows={4}
            placeholder="发生了什么？在什么页面？"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="feedback-contact" className="text-sm">
            联系方式（选填）
          </label>
          <Input
            id="feedback-contact"
            value={contact}
            onChange={(event) => setContact(event.target.value)}
            maxLength={200}
            placeholder="邮箱 / QQ，方便我们回复你"
          />
        </div>

        {state === "success" && (
          <p className="text-sm text-[var(--color-success)]">
            感谢反馈，我们会尽快查看
          </p>
        )}
        {state === "error" && (
          <p className="text-sm text-[var(--color-error)]" role="alert">
            提交失败，请稍后重试。
          </p>
        )}

        <Button
          type="button"
          onClick={submit}
          disabled={submitting || !content.trim()}
          className="h-9 w-full"
        >
          {submitting ? "提交中…" : "提交反馈"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
