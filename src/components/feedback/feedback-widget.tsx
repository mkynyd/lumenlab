"use client";

import { useRef, useState } from "react";
import { ChevronRight, MessageSquarePlus } from "lucide-react";
import Feedback1, { type FeedbackKind, type FeedbackStatus } from "@/components/blocks/feedback-1";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export function FeedbackWidget({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<FeedbackKind>("bug");
  const [content, setContent] = useState("");
  const [contact, setContact] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<FeedbackStatus>("idle");
  const submissionVersion = useRef(0);

  function reset() {
    submissionVersion.current += 1;
    setCategory("bug");
    setContent("");
    setContact("");
    setSubmitting(false);
    setStatus("idle");
  }

  async function submit() {
    if (!content.trim() || submitting) return;
    const version = ++submissionVersion.current;
    setSubmitting(true);
    setStatus("idle");
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
      if (!response.ok) throw new Error(String(response.status));
      if (version === submissionVersion.current) {
        setStatus("success");
        setContent("");
        setContact("");
      }
    } catch {
      if (version === submissionVersion.current) setStatus("error");
    } finally {
      if (version === submissionVersion.current) setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) reset(); }}>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label="反馈"
          className={cn(
            "flex h-12 w-full shrink-0 items-center gap-3 px-4 text-left text-sm sm:h-10 sm:gap-2.5 sm:rounded-lg sm:px-3",
            "text-[var(--color-text-primary)] sm:text-[var(--color-text-secondary)] sm:hover:bg-[var(--color-interaction-hover)] sm:hover:text-[var(--color-text-primary)]",
            "transition-colors duration-150 focus-visible:bg-[var(--color-interaction-active)] focus-visible:outline-none active:bg-[var(--color-interaction-hover)] motion-reduce:transition-none",
            className
          )}
        >
          <MessageSquarePlus size={16} strokeWidth={1.5} className="text-[var(--color-text-secondary)]" aria-hidden="true" />
          <span className="flex-1">反馈</span>
          <ChevronRight size={15} strokeWidth={1.8} className="text-[var(--color-text-tertiary)] sm:hidden" aria-hidden="true" />
        </button>
      </DialogTrigger>
      <DialogContent showCloseButton={false} className="max-h-[calc(100dvh-2rem)] w-[min(28rem,calc(100vw-2rem))] overflow-y-auto p-2 sm:max-w-[28rem]">
        <Feedback1
          kind={category}
          message={content}
          contact={contact}
          status={status}
          submitting={submitting}
          onKindChange={setCategory}
          onMessageChange={setContent}
          onContactChange={setContact}
          onSubmit={submit}
          onReset={reset}
          onClose={() => { setOpen(false); reset(); }}
        />
      </DialogContent>
    </Dialog>
  );
}
