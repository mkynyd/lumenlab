"use client";

import { useState } from "react";
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

export function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<Category>("bug");
  const [content, setContent] = useState("");
  const [contact, setContact] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [state, setState] = useState<"idle" | "success" | "error">("idle");

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
          type="button"
          className="fixed right-4 bottom-20 z-30 inline-flex h-9 items-center gap-1.5 rounded-full bg-[var(--color-panel-muted)] px-4 text-sm text-[var(--color-text-secondary)] transition-[background-color,color,transform] duration-150 hover:bg-[var(--color-interaction-active)] hover:text-[var(--color-text-primary)] active:scale-[0.97] sm:right-6 sm:bottom-6"
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
